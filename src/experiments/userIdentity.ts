// ABOUTME: Resolves a display name + handle for a comment author, from a real
// ABOUTME: Bluesky profile, an LLM-generated identity, or a procedural fallback.

import { profileResolver } from "./profileResolver";

export interface Identity {
  name: string;
  handle: string;
  avatar?: string;
}

const FIRST_NAMES = [
  "maya", "jake", "sofia", "aiden", "lila", "marcus", "zoe", "ethan", "priya",
  "noah", "iris", "leo", "chloe", "kai", "ella", "dev", "sam", "ravi", "nina",
  "theo", "june", "owen", "mira", "felix", "luna", "max", "ada", "rosa",
];

const HANDLE_PARTS = [
  "online", "irl", "posts", "daily", "real", "official", "hq", "world",
  "tv", "fm", "dot", "central", "club", "zone", "core",
];

// Deterministic pseudo-random from a string seed, so the same comment id always
// yields the same fallback identity (no flicker on re-render).
function seededInt(seed: string, max: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % max;
}

function proceduralIdentity(seed: string): Identity {
  const first = FIRST_NAMES[seededInt(seed + "n", FIRST_NAMES.length)];
  const part = HANDLE_PARTS[seededInt(seed + "h", HANDLE_PARTS.length)];
  const num = seededInt(seed + "d", 999);
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  const style = seededInt(seed + "s", 3);
  const handle =
    style === 0
      ? `${first}${num}`
      : style === 1
        ? `${first}_${part}`
        : `${first}${part}`;
  return { name, handle };
}

export interface CommentAuthor {
  sourceDid?: string;
  // Identity baked in at creation time (e.g. LLM-generated), used when there is
  // no real profile to resolve.
  name?: string;
  handle?: string;
  // Stable seed for the procedural fallback (typically the comment id).
  seed: string;
}

// Resolve the best available identity for a comment author. Real profiles take
// precedence, then a baked-in identity, then a deterministic procedural one.
export function resolveCommentAuthor(author: CommentAuthor): Identity {
  if (author.sourceDid) {
    const profile = profileResolver.peek(author.sourceDid);
    if (profile) {
      return {
        name: profile.displayName || profile.handle,
        handle: profile.handle,
        avatar: profile.avatar,
      };
    }
    if (profile === undefined) {
      // Not yet resolved — kick off resolution; render fallback meanwhile.
      profileResolver.get(author.sourceDid);
    }
  }
  if (author.name && author.handle) {
    return { name: author.name, handle: author.handle };
  }
  return proceduralIdentity(author.seed);
}
