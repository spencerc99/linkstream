// Resolves Bluesky DIDs to profiles (handle, displayName, avatar).
// Batches requests against the public AppView to stay under rate limits.

export interface BskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

const BSKY_APPVIEW = "https://public.api.bsky.app";
const BATCH_SIZE = 25;
const BATCH_INTERVAL_MS = 600;

type Subscriber = () => void;

class ProfileResolver {
  private cache = new Map<string, BskyProfile | null>();
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
    setInterval(() => void this.flush(), BATCH_INTERVAL_MS);
  }

  private async flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, BATCH_SIZE);
    batch.forEach((d) => this.pending.delete(d));
    try {
      const params = batch
        .map((d) => `actors=${encodeURIComponent(d)}`)
        .join("&");
      const res = await fetch(
        `${BSKY_APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`
      );
      if (!res.ok) {
        // Mark as null so we don't retry forever
        for (const did of batch) {
          if (!this.cache.has(did)) this.cache.set(did, null);
        }
        this.notify();
        return;
      }
      const data = (await res.json()) as {
        profiles?: Array<{
          did: string;
          handle: string;
          displayName?: string;
          avatar?: string;
        }>;
      };
      const resolved = new Set<string>();
      for (const p of data.profiles || []) {
        this.cache.set(p.did, {
          did: p.did,
          handle: p.handle,
          displayName: p.displayName,
          avatar: p.avatar,
        });
        resolved.add(p.did);
      }
      for (const did of batch) {
        if (!resolved.has(did)) this.cache.set(did, null);
      }
      this.notify();
    } catch (e) {
      console.error("profile resolver batch failed", e);
    }
  }

  // Returns profile or null if unresolvable or undefined if still pending.
  get(did: string): BskyProfile | null | undefined {
    if (this.cache.has(did)) return this.cache.get(did);
    if (!this.pending.has(did)) {
      this.pending.add(did);
      this.queue.push(did);
      this.startTicker();
    }
    return undefined;
  }

  peek(did: string): BskyProfile | null | undefined {
    return this.cache.get(did);
  }
}

export const profileResolver = new ProfileResolver();
