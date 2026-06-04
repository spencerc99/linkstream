# FakeMessages: Quote-Post Embeds & Accounts-Mode Reply Filter

Date: 2026-06-02

Two fixes to `src/experiments/FakeMessages.tsx`, both addressing lost context in the
Messages experiment.

## Problem 1: Quote posts lose their context

A post that quotes another post (a "quote tweet") currently renders with no sign of the
quoted content. `extractEmbed` only handles `app.bsky.embed.images` and
`app.bsky.embed.external`. Quote embeds (`app.bsky.embed.record`) and quote-with-media
(`app.bsky.embed.recordWithMedia`) are dropped — the `recordWithMedia` branch even pulls
only the media half, discarding the quoted post entirely. The result reads as a
non-sequitur because the post often only makes sense alongside what it quotes.

## Problem 2: Accounts mode mixes repliers from different people

`routeReplyToMe` routes *any* firehose reply to one of the user's posts back into the
tracked conversation. In Accounts mode a conversation represents a single account, so when
two different people reply to the user's post, both land in the same chat. `getReplyTarget`
then replies only to the most recent incoming message, so the user can unknowingly reply to
the wrong person — breaking the strict 1:1 "every account is its own contact" model.

Groups mode is intentionally multi-person, so this only affects Accounts mode.

---

## Design

### Quote embeds

The firehose commit record for a quote post contains only the quoted post's AT-URI and CID,
not its text or author. To render meaningful context we fetch the quoted post once, cache
it, and render a dedicated quote card — mirroring the existing `backfillThread` fetch
pattern.

**New embed variant.** Add to the `MessageEmbed` union:

```ts
| {
    kind: "quote";
    uri: string;            // quoted post AT-URI
    authorDid?: string;
    authorName?: string;
    authorHandle?: string;
    authorAvatar?: string;
    text?: string;
    media?: MessageEmbed;   // images/external from the quoted post, if any
  }
```

**Extraction.** `extractEmbed` recognizes:
- `app.bsky.embed.record` → quote with `uri`/`cid` from `embed.record`.
- `app.bsky.embed.recordWithMedia` → quote (from `embed.record.record`) *and* media
  (existing logic on `embed.media`). The quote card carries the media inline.

At extraction time only `uri` is known. Author/text are filled in asynchronously.

**Fetching the quoted post.** A small session-scoped resolver (same shape/spirit as
`backfilledThreads` + `profileResolver`): keyed by quoted-post URI, dedupes in-flight
fetches, calls `app.bsky.feed.getPosts?uris=...` against the public AppView, hydrates the
quoted author into `profileResolver`, and notifies subscribers so the bubble re-renders.
Batches like `profileResolver` if simple; one-at-a-time is acceptable for v1 given quotes
are comparatively rare.

The embed stored on the message starts with just `uri`; when the fetch resolves, the quote
card reads author/text from the resolver cache (peek by URI) at render time. This keeps the
delivery path synchronous and avoids mutating already-delivered messages.

**Rendering.** `MessageEmbedView` gains a `quote` branch rendered *below* the quoting
post's own text (nested card): quoted author avatar + display name + handle + quoted text,
plus nested media if present. The whole card links to the original post on bsky.app. While
the fetch is pending, show a minimal placeholder (e.g. the host/URI) so layout is stable.

### Accounts-mode reply filter

In `routeReplyToMe`, when `target.mode === "accounts"`, only route the incoming reply if it
comes from the account that conversation belongs to (`post.did === target.conversationId`).
Otherwise return `true` (consume the post so it is not re-routed through normal intake) but
do not add it to the conversation.

Groups mode is unchanged — it continues routing every replier.

Effect: an Accounts conversation contains only that one account's posts plus the user's
replies, so `getReplyTarget`'s "last incoming" is unambiguously that account. No new
conversations are created.

---

## Components touched

- `MessageEmbed` union — add `quote` variant.
- `extractEmbed` — handle `record` and `recordWithMedia`.
- New quote-post resolver (URI → quoted author/text), session-scoped, subscribable.
- `MessageEmbedView` — new `quote` render branch.
- `routeReplyToMe` — accounts-mode same-author filter.

## Data flow (quote)

1. Firehose post with `embed.record` → `extractEmbed` returns `{kind: "quote", uri}`.
2. Delivery stores the embed on the message as-is.
3. Render: quote card requests the quoted post from the resolver (`get(uri)`); pending →
   placeholder; resolved → full card. Resolver hydrates `profileResolver` for the author.
4. Resolver notify → re-render → full quote card.

## Error handling

- Quoted-post fetch fails or returns nothing → resolver caches a null/empty result (no
  retry loop, like `profileResolver`); quote card falls back to a plain link to the quoted
  URI.
- Blocked/not-found quoted posts → treated as the empty case (link fallback).

## Testing

Experiment has no test harness; verification is manual against the live firehose:
- Quote post renders a card with quoted author + text; clicking opens the original.
- Quote-with-media renders both the quoted text and its media.
- In Accounts mode, a reply from a different person to your post does not appear in the
  chat; a reply from the same account does.
- Groups mode still shows all repliers.

## Out of scope

- Recursive quotes (a quote of a quote) — render one level; nested quote shows as a link.
- Backfilling quote context for posts already delivered before the fetch resolved beyond
  the subscribe-driven re-render.
