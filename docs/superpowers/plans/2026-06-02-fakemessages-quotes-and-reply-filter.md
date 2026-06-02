# FakeMessages: Quote Embeds & Accounts Reply Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render quote posts as a dedicated quoted-post card in the Messages experiment, and stop Accounts-mode conversations from mixing in replies from people other than the account that conversation belongs to.

**Architecture:** Add a `quote` variant to the `MessageEmbed` union; extend `extractEmbed` to recognize `app.bsky.embed.record` and `app.bsky.embed.recordWithMedia`; add a session-scoped `quotedPostResolver` (URI → quoted author/text, subscribable, like `profileResolver`) that lazily fetches quoted posts via `app.bsky.feed.getPosts` and hydrates `profileResolver`; add a `quote` render branch to `MessageEmbedView` that reads from the resolver at render time; and add a same-author filter to `routeReplyToMe` for Accounts mode.

**Tech Stack:** React + TypeScript, Vite, Bluesky public AppView XRPC. No test runner exists — verification is `npm run lint` (tsc + eslint, `--max-warnings 0`) plus manual checks against the live firehose via `npm run dev`.

---

## File Structure

- `src/experiments/quotedPostResolver.ts` — **Create.** Resolves quoted-post AT-URIs to `{author, text, media}`, batched against the AppView, subscribable. Mirrors `profileResolver.ts`.
- `src/experiments/FakeMessages.tsx` — **Modify.** `MessageEmbed` union, `extractEmbed`, `MessageEmbedView`, `routeReplyToMe`, subscribe to the new resolver, and `renderPreview` snippet for quotes.
- `src/experiments/FakeMessages.scss` — **Modify.** Styles for the quote card.

No test files — the experiment has no test harness and adding one is out of scope (YAGNI). Each task ends with `npm run lint` and, where behavior is observable, a manual firehose check.

---

## Task 1: Add the `quote` variant to the `MessageEmbed` union

**Files:**
- Modify: `src/experiments/FakeMessages.tsx:66-74`

- [ ] **Step 1: Extend the union**

In `src/experiments/FakeMessages.tsx`, replace the `MessageEmbed` type (currently lines 66-74) with:

```ts
type MessageEmbed =
  | { kind: "images"; images: { url: string; alt?: string }[] }
  | {
      kind: "external";
      uri: string;
      title?: string;
      description?: string;
      thumb?: string;
    }
  | {
      // A quoted post. Only `uri` is known at firehose time; the quoted
      // author/text/media are filled in by quotedPostResolver at render time.
      kind: "quote";
      uri: string;
      media?: MessageEmbed;
    };
```

Note `media` is recursive (`MessageEmbed`) so quote-with-media can carry the quoted post's
images/external card. TypeScript allows the self-reference in a `type` alias.

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS (no type errors). The new variant is not yet produced or consumed, so this
only checks the type is well-formed.

- [ ] **Step 3: Commit**

```bash
git add src/experiments/FakeMessages.tsx
git commit -m "Add quote variant to MessageEmbed union"
```

---

## Task 2: Create the quoted-post resolver

**Files:**
- Create: `src/experiments/quotedPostResolver.ts`

- [ ] **Step 1: Write the resolver**

Create `src/experiments/quotedPostResolver.ts`:

```ts
// ABOUTME: Resolves quoted-post AT-URIs to their author and text for rendering
// ABOUTME: quote cards, batching requests against the Bluesky public AppView.
import { profileResolver } from "./profileResolver";

export interface QuotedPost {
  uri: string;
  authorDid: string;
  authorHandle: string;
  authorName?: string;
  authorAvatar?: string;
  text: string;
}

const BSKY_APPVIEW = "https://public.api.bsky.app";
const BATCH_SIZE = 25;
const BATCH_INTERVAL_MS = 200;

type Subscriber = () => void;

class QuotedPostResolver {
  private cache = new Map<string, QuotedPost | null>();
  private pending = new Set<string>();
  private queue: string[] = [];
  private subscribers = new Set<Subscriber>();
  private tickerStarted = false;

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify() {
    for (const fn of this.subscribers) fn();
  }

  private startTicker() {
    if (this.tickerStarted) return;
    this.tickerStarted = true;
    setInterval(() => {
      if (this.queue.length > 0) void this.flush();
    }, BATCH_INTERVAL_MS);
  }

  private async flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, BATCH_SIZE);
    batch.forEach((u) => this.pending.delete(u));
    try {
      const params = batch
        .map((u) => `uris=${encodeURIComponent(u)}`)
        .join("&");
      const res = await fetch(
        `${BSKY_APPVIEW}/xrpc/app.bsky.feed.getPosts?${params}`,
      );
      if (!res.ok) {
        for (const uri of batch) {
          if (!this.cache.has(uri)) this.cache.set(uri, null);
        }
        this.notify();
        return;
      }
      const data = (await res.json()) as {
        posts?: Array<{
          uri: string;
          author: {
            did: string;
            handle: string;
            displayName?: string;
            avatar?: string;
          };
          record?: { text?: string };
        }>;
      };
      const resolved = new Set<string>();
      for (const p of data.posts || []) {
        const text = typeof p.record?.text === "string" ? p.record.text : "";
        this.cache.set(p.uri, {
          uri: p.uri,
          authorDid: p.author.did,
          authorHandle: p.author.handle,
          authorName: p.author.displayName,
          authorAvatar: p.author.avatar,
          text,
        });
        profileResolver.hydrate({
          did: p.author.did,
          handle: p.author.handle,
          displayName: p.author.displayName,
          avatar: p.author.avatar,
        });
        resolved.add(p.uri);
      }
      // Posts that didn't come back (blocked/deleted) cache as null so we don't retry.
      for (const uri of batch) {
        if (!resolved.has(uri)) this.cache.set(uri, null);
      }
      this.notify();
    } catch (e) {
      console.error("quoted post resolver batch failed", e);
    }
  }

  // Returns the quoted post, null if unresolvable, or undefined if still pending.
  get(uri: string): QuotedPost | null | undefined {
    if (this.cache.has(uri)) return this.cache.get(uri);
    if (!this.pending.has(uri)) {
      this.pending.add(uri);
      this.queue.push(uri);
      this.startTicker();
    }
    return undefined;
  }

  peek(uri: string): QuotedPost | null | undefined {
    return this.cache.get(uri);
  }
}

export const quotedPostResolver = new QuotedPostResolver();
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS. The module is not yet imported, so this only type-checks the file itself.

- [ ] **Step 3: Commit**

```bash
git add src/experiments/quotedPostResolver.ts
git commit -m "Add quotedPostResolver for fetching quoted post author/text"
```

---

## Task 3: Extract quote embeds in `extractEmbed`

**Files:**
- Modify: `src/experiments/FakeMessages.tsx:176-206`

- [ ] **Step 1: Add quote extraction**

In `extractEmbed`, the current body resolves `embed` as `record?.embed?.media ?? record?.embed`
to reach the media inside `recordWithMedia`. We now also need the quote half, so handle the
record/recordWithMedia types explicitly. Replace the function (currently lines 176-206) with:

```ts
// Pull a renderable embed (image, link-card, or quoted post) out of a post
// record, if any. For quote-with-media, the quoted post's media is nested.
function extractEmbed(record: any, did: string): MessageEmbed | undefined {
  const outer = record?.embed;
  const outerType = outer?.$type as string | undefined;
  if (!outerType) return undefined;

  // A quote post: app.bsky.embed.record carries the quoted post's strongRef.
  if (outerType === "app.bsky.embed.record") {
    const uri = outer.record?.uri as string | undefined;
    return uri ? { kind: "quote", uri } : undefined;
  }

  // Quote-with-media: quote ref under .record.record, media under .media.
  if (outerType === "app.bsky.embed.recordWithMedia") {
    const uri = outer.record?.record?.uri as string | undefined;
    if (!uri) return undefined;
    const media = extractMediaEmbed(outer.media, did);
    return { kind: "quote", uri, media };
  }

  return extractMediaEmbed(outer, did);
}

// Pull an image or external link-card embed out of a media embed object.
function extractMediaEmbed(
  embed: any,
  did: string,
): MessageEmbed | undefined {
  const type = embed?.$type as string | undefined;
  if (!type) return undefined;

  if (type === "app.bsky.embed.images" && Array.isArray(embed.images)) {
    const images = embed.images
      .map((img: any) => {
        const url = imageCdnUrl(did, img.image);
        return url ? { url, alt: img.alt } : null;
      })
      .filter(Boolean) as { url: string; alt?: string }[];
    if (images.length > 0) return { kind: "images", images };
  }

  if (type === "app.bsky.embed.external" && embed.external?.uri) {
    const ext = embed.external;
    return {
      kind: "external",
      uri: ext.uri,
      title: ext.title || undefined,
      description: ext.description || undefined,
      thumb: ext.thumb
        ? imageCdnUrl(did, ext.thumb, "thumbnail") || undefined
        : undefined,
    };
  }

  return undefined;
}
```

This splits the old image/external logic into `extractMediaEmbed` (reused for both
top-level media and the nested media of a quote-with-media), and adds the two quote cases.

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/experiments/FakeMessages.tsx
git commit -m "Extract quote embeds from record and recordWithMedia"
```

---

## Task 4: Render the quote card

**Files:**
- Modify: `src/experiments/FakeMessages.tsx` (`MessageEmbedView`, ~256-293)
- Modify: `src/experiments/FakeMessages.tsx` (import block, line 5)

- [ ] **Step 1: Import the resolver**

At the top of `FakeMessages.tsx`, add after the `profileResolver` import (line 5):

```ts
import { quotedPostResolver } from "./quotedPostResolver";
```

- [ ] **Step 2: Add the quote branch to `MessageEmbedView`**

In `MessageEmbedView`, add a `quote` branch before the existing `external`/`images` handling.
The component currently handles `images` first, then falls through to `external`. Add at the
top of the function body (right after the opening `{`):

```ts
  if (embed.kind === "quote") {
    const quoted = quotedPostResolver.get(embed.uri);
    const appUrl = bskyAppUrlFromUri(embed.uri);
    return (
      <a
        className="embed-quote"
        href={appUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {quoted ? (
          <>
            <div className="quote-author">
              {quoted.authorAvatar && (
                <img
                  className="quote-avatar"
                  src={quoted.authorAvatar}
                  alt=""
                  loading="lazy"
                />
              )}
              <span className="quote-name">
                {quoted.authorName || quoted.authorHandle}
              </span>
              <span className="quote-handle">@{quoted.authorHandle}</span>
            </div>
            {quoted.text && <span className="quote-text">{quoted.text}</span>}
          </>
        ) : (
          <span className="quote-pending">quoted post</span>
        )}
        {embed.media && (
          <div className="quote-media">
            <MessageEmbedView embed={embed.media} />
          </div>
        )}
      </a>
    );
  }
```

`quotedPostResolver.get` returns `undefined` while pending (shows placeholder) and `null` if
unresolvable (also shows placeholder, links to the URI). When it resolves, the resolver's
`notify()` triggers a re-render via the existing profile-tick subscription added in Task 5.

**HTML nesting caveat:** the outer quote card is an `<a>`, and the existing `external` media
branch is also an `<a>` — nesting `<a>` inside `<a>` is invalid HTML. For quote-with-media,
render the nested media's *images only* directly and skip an inner anchor. Replace the media
block at the bottom of the quote branch with:

```ts
        {embed.media?.kind === "images" && (
          <div className="quote-media">
            <MessageEmbedView embed={embed.media} />
          </div>
        )}
```

(`images` renders a `<div>` of `<img>`, no anchor — safe to nest. A quoted post's external
card is dropped from the inline view; the card still links to the full quoted post on
bsky.app, so that context isn't lost.)

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/experiments/FakeMessages.tsx
git commit -m "Render quote card in MessageEmbedView"
```

---

## Task 5: Re-render on quote resolution

**Files:**
- Modify: `src/experiments/FakeMessages.tsx:459-462` (the profile-tick subscription effect)

- [ ] **Step 1: Subscribe to the quote resolver**

The component already re-renders on `profileResolver` resolution via a `setProfileTick`
subscription (lines 459-462). Quote resolution must also trigger a re-render. Replace that
effect:

```ts
  // Re-render when profiles resolve
  useEffect(() => {
    return profileResolver.subscribe(() => setProfileTick((t) => t + 1));
  }, []);
```

with:

```ts
  // Re-render when profiles or quoted posts resolve
  useEffect(() => {
    const unsubProfile = profileResolver.subscribe(() =>
      setProfileTick((t) => t + 1),
    );
    const unsubQuote = quotedPostResolver.subscribe(() =>
      setProfileTick((t) => t + 1),
    );
    return () => {
      unsubProfile();
      unsubQuote();
    };
  }, []);
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/experiments/FakeMessages.tsx
git commit -m "Re-render messages when quoted posts resolve"
```

---

## Task 6: Quote snippet in the sidebar preview

**Files:**
- Modify: `src/experiments/FakeMessages.tsx` (`renderPreview`, ~1646-1656)

- [ ] **Step 1: Add a quote case to the attachment snippet**

In `renderPreview`, the snippet logic describes the last message's attachment. It currently
handles `images` and `external`. Add a `quote` case. Replace this block:

```ts
  } else if (last.embed?.kind === "images") {
    const n = last.embed.images.length;
    snippet = `📷 ${n} ${n === 1 ? "Image" : "Images"}`;
  } else if (last.embed?.kind === "external") {
    snippet = "🔗 Link";
  } else {
    snippet = "";
  }
```

with:

```ts
  } else if (last.embed?.kind === "images") {
    const n = last.embed.images.length;
    snippet = `📷 ${n} ${n === 1 ? "Image" : "Images"}`;
  } else if (last.embed?.kind === "external") {
    snippet = "🔗 Link";
  } else if (last.embed?.kind === "quote") {
    snippet = "💬 Quoted post";
  } else {
    snippet = "";
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/experiments/FakeMessages.tsx
git commit -m "Show quoted-post snippet in sidebar preview"
```

---

## Task 7: Style the quote card

**Files:**
- Modify: `src/experiments/FakeMessages.scss`

- [ ] **Step 1: Find where embed styles live**

Run: `rg -n "embed-external|embed-images|embed-meta" src/experiments/FakeMessages.scss`
Expected: locates the existing embed style block. Add the quote styles adjacent to it,
matching the surrounding nesting/indentation style.

- [ ] **Step 2: Add quote card styles**

Add near the other `.embed-*` rules (match the file's existing color variables / nesting
conventions — read the neighbours first and mirror them rather than copying these values
verbatim if the file uses SCSS variables):

```scss
.embed-quote {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;

  .quote-author {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .quote-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
  }

  .quote-name {
    font-weight: 600;
  }

  .quote-handle {
    opacity: 0.6;
    font-size: 0.85em;
  }

  .quote-text {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .quote-pending {
    opacity: 0.6;
    font-style: italic;
  }

  .quote-media {
    margin-top: 4px;
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: PASS (SCSS is compiled by Vite at build/dev; lint covers TS. Also run
`npm run build` if you want to confirm the SCSS compiles, optional).

- [ ] **Step 4: Commit**

```bash
git add src/experiments/FakeMessages.scss
git commit -m "Style the quote card"
```

---

## Task 8: Accounts-mode reply filter

**Files:**
- Modify: `src/experiments/FakeMessages.tsx:782-820` (`routeReplyToMe`)

- [ ] **Step 1: Add the same-author filter**

In `routeReplyToMe`, after resolving `target` and `post`, drop replies in Accounts mode that
come from a different account than the conversation belongs to. The conversation id in
Accounts mode is the account's DID. Add this guard right after the
`if (post.isNsfw && !showNsfwRef.current) return true;` line (currently line 793):

```ts
    // In Accounts mode each conversation is a single account. A reply to your
    // post from someone other than that account reads as a non-sequitur, so we
    // consume it (return true) without routing it into the chat. Groups mode is
    // intentionally multi-person, so it keeps every replier.
    if (target.mode === "accounts" && post.did !== target.conversationId) {
      return true;
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/experiments/FakeMessages.tsx
git commit -m "Drop cross-account replies in Accounts mode conversations"
```

---

## Task 9: Manual verification against the live firehose

**Files:** none (verification only)

- [ ] **Step 1: Run the app**

Run: `npm run dev`
Open the Messages experiment in the browser.

- [ ] **Step 2: Verify quote rendering (Accounts mode)**

Watch the firehose until a quote post lands (a post whose original on bsky.app shows a
quoted post). Confirm:
- A bordered quote card appears below the message text.
- The card shows the quoted author's name/handle (and avatar if present) and quoted text.
- Clicking the card opens the quoted post on bsky.app.
- A quote-with-media post additionally shows the quoted post's image/link inside the card.
- The sidebar preview for such a message reads "💬 Quoted post" when it's the latest.

If quote posts are slow to appear, note that this is expected (they are rarer than plain
posts); leave it running.

- [ ] **Step 3: Verify Accounts-mode reply filter**

Sign in to Bluesky in the experiment. In Accounts mode, open a conversation and send a reply
(this posts a real reply). Have a second account (or ask someone) reply to your original
*and* have a third party reply to the same post. Confirm only the conversation account's own
follow-up appears in the chat; the third party's reply does not show up. The reply indicator
continues to point at that account's post.

Note: this requires a real second/third actor on Bluesky. If unavailable, verify by code
inspection that the guard in `routeReplyToMe` returns `true` (consumes, does not route) when
`post.did !== target.conversationId` in Accounts mode, and confirm Groups mode is untouched.

- [ ] **Step 4: Final lint**

Run: `npm run lint`
Expected: PASS, zero warnings.

---

## Self-Review Notes

- **Spec coverage:** Quote variant (Task 1), extraction incl. recordWithMedia (Task 3),
  resolver fetch + profileResolver hydration (Task 2), render card below text (Task 4),
  pending/null fallback to link (Task 4), re-render on resolve (Task 5), accounts filter
  (Task 8). Sidebar preview (Task 6) and styling (Task 7) round out rendering. All spec
  sections map to a task.
- **Recursive media:** `MessageEmbed.media?: MessageEmbed` (Task 1) is consumed by Task 4's
  nested `<MessageEmbedView embed={embed.media} />` and produced by Task 3's
  `extractMediaEmbed(outer.media, did)`. Names consistent across tasks.
- **No test runner:** intentional — verification is lint + manual (documented in spec).
  Out of scope: recursive quote-of-quote (renders nested quote's `uri` only via its own
  card, one level).
