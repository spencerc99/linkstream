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
