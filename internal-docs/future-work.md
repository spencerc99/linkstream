# Future Work

Running list of ideas raised during design conversations but deferred. Dated
entries; add to the bottom.

---

## 2026-04-14 — HAH leaderboard via custom AT Protocol lexicon

### Context

Messages experiment now tracks session-local reply counts + rate (see the
`.score-bar` in `FakeMessages.tsx`). Current state is intentionally ephemeral
— refresh wipes it — because making it a persistent personal high-score would
flip the piece from satire into actual gamification.

But a **collective, cross-user leaderboard** is a different beast. HAH is
about subverting the algorithm through *mass action*. A leaderboard that
aggregates HAH replies across all opted-in participants would:

- Make the participation visible to participants (and potential participants)
- Create a shared artifact of collective subversion
- Turn the individual "engagement score" into evidence of a movement
- Invert the usual leaderboard logic: the top of the board isn't "most
  optimized poster" but "most HAH-complicit human"

### Sketch: custom AT Proto lexicon

Define a new namespaced lexicon for HAH-specific records. Something like
`art.hah.reply` or `social.hah.action`. Users who opt in would write these
records to their own PDS each time they complete a HAH action (sending a
Messages reply, participating in a score, etc.).

Because AT Proto is public, anyone can query these records across all repos
that have them. That's the unlock: no central database, no server we have to
run. The leaderboard is just an aggregate query over the protocol.

Rough lexicon shape (not finalized):

```json
{
  "lexicon": 1,
  "id": "art.hah.action",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["type", "createdAt"],
        "properties": {
          "type": {
            "type": "string",
            "knownValues": ["messages-reply", "score-completed", "score-derivative"]
          },
          "subject": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "The post or record this action targets"
          },
          "score": {
            "type": "string",
            "description": "Slug of the HAH score being performed, if any"
          },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

When a user sends a real reply in Messages mode (already OAuth-authenticated),
we'd ALSO write an `art.hah.action` record with type `messages-reply` and
subject pointing to the reply. Opt-in via a toggle in the auth bar.

### How the leaderboard reads

Options, roughly ordered cheapest → deepest:

1. **Off-chain aggregator**: a tiny worker/function that listens to the
   firehose, filters for `art.hah.action` collection writes, and keeps a
   Redis/D1 count per DID. Leaderboard endpoint returns top N. Cheap,
   responsive, minimally centralized.
2. **Query on-demand via AppView**: traverse `com.atproto.repo.listRecords`
   per DID. Too slow for a real leaderboard but fine for "my actions" view.
3. **AT Proto AppView for HAH**: full custom AppView that indexes
   `art.hah.action` collection across the network. Proper federated
   infrastructure; overkill for a first version but the principled path.

Start with (1). It's a small worker similar to `workers/haiku`.

### Open questions

- **Opt-in default**: off. Users explicitly toggle "publish my replies as
  HAH actions" in the auth bar. Defaults-on would be a consent violation.
- **Scope beyond Messages**: does the lexicon cover all HAH actions (Score
  Gallery participation, Poster compositions, etc.) or only Messages?
  Probably all, with a `type` enum. Shared lexicon, varied sources.
- **Display name for the leaderboard**: DID? Handle? Opted-in display name?
  Handle is fine since it's already public for anyone posting on Bluesky.
- **Sybil/abuse**: someone could script thousands of `art.hah.action` writes
  without actually doing anything. Two mitigations: the `subject` strongRef
  must resolve to a real post by the user (verifiable), and we could rate
  limit displayed scores (e.g. max 1 action/minute counted).
- **Un-opting-out**: if someone wants to un-publish, they delete the records
  from their PDS. Aggregator should honor deletions via the firehose.
- **Relationship to the real score-bar**: leaderboard entry counts and the
  in-app score should come from the same source of truth (the records). So
  signing in + opting in would replace the ephemeral session score with a
  persistent (but user-controlled) one derived from their own repo.

### Dependencies

- Production deployment with a stable origin (client-metadata.json currently
  has `REPLACE_WITH_DEPLOYED_ORIGIN` placeholders)
- Lexicon registration — see
  https://atproto.com/guides/lexicon — namespace should be under a domain
  the project controls
- One small Cloudflare Worker (like `workers/haiku`) subscribed to the
  relevant Jetstream collection
- Storage: D1 or KV for the aggregate counts

### Scope guess

~1-2 day build once the deploy origin exists. Lexicon design +
 publishing: ~half day. Worker aggregator: ~half day. UI: opt-in toggle +
 leaderboard page: ~half day.
