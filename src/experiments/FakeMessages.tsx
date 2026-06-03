import { useState, useCallback, useRef, useEffect } from "react";
import { useJetStream } from "../hooks/useJetStream";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { profileResolver } from "./profileResolver";
import { quotedPostResolver } from "./quotedPostResolver";
import { useBskyAuth } from "./useBskyAuth";
import { postReply, type ReplyTarget } from "./bskyAuth";
import { useDocumentTitle } from "./useDocumentTitle";
import {
  playMessageSound,
  isMessageSoundEnabled,
  setMessageSoundEnabled,
} from "./messageSound";
import "./FakeMessages.scss";

type MessagesMode = "accounts" | "groups";

const TAPBACK_REACTIONS = [
  "\u2764\uFE0F",
  "\uD83D\uDC4D",
  "\uD83D\uDC4E",
  "\uD83D\uDE02",
  "\u203C\uFE0F",
  "\u2753",
];

const MODE_STORAGE_KEY = "hah.messages.mode";
const NSFW_STORAGE_KEY = "hah.messages.showNsfw";

function loadStoredMode(): MessagesMode {
  if (typeof localStorage === "undefined") return "accounts";
  const raw = localStorage.getItem(MODE_STORAGE_KEY);
  if (raw === "accounts" || raw === "groups") return raw;
  return "accounts";
}

function loadStoredShowNsfw(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(NSFW_STORAGE_KEY) === "1";
}

// Deterministic color from a string (for account/group participant avatars)
const AVATAR_PALETTE = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFD93D",
  "#C9B1FF",
  "#98D8C8",
  "#F4A261",
  "#FF9FF3",
  "#54A0FF",
  "#FF8FA3",
  "#9FE870",
  "#7F9CF5",
  "#F0A58F",
];

function colorForDid(did: string): string {
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = (hash * 31 + did.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// ---- Shared types ---------------------------------------------------------

// Image or link-card attached to a post, rendered inline in the bubble.
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

interface Message {
  id: string;
  text: string;
  timestamp: number;
  fromContact: boolean;
  reaction?: string;
  sourceDid?: string;
  sourceRkey?: string;
  sourceCid?: string;
  sourceUri?: string;
  embed?: MessageEmbed;
  // For group chats: which participant authored this message
  authorDid?: string;
  authorName?: string;
  authorColor?: string;
}

interface Conversation {
  id: string;
  kind: MessagesMode;
  displayName: string;
  subtitle?: string;
  avatarColor: string;
  avatarInitial: string;
  avatarUrl?: string;
  // For groups: participant DIDs
  participants?: Set<string>;
  // For groups: root post URI + CID, needed to construct real replies
  rootUri?: string;
  rootCid?: string;
  messages: Message[];
  unreadCount: number;
  isTyping: boolean;
  lastActivity: number;
  userReplied?: boolean;
  // Real replies the user has posted to Bluesky in this convo
  realReplies?: number;
}

interface PendingDelivery {
  mode: MessagesMode;
  conversationId: string;
  text: string;
  timestamp: number;
  did: string;
  rkey: string;
  cid?: string;
  embed?: MessageEmbed;
  // For groups
  authorDid?: string;
}

// ---- Firehose filtering ---------------------------------------------------

// Self-applied content labels (set by the poster) that we treat as NSFW.
const NSFW_LABELS = new Set([
  "porn",
  "nudity",
  "sexual",
  "graphic-media",
  "gore",
  "nsfw",
  "adult content",
]);

// Whether a post record carries a self-label we consider NSFW.
function hasNsfwLabel(record: any): boolean {
  const values = record?.labels?.values;
  if (!Array.isArray(values)) return false;
  return values.some((v: any) => {
    const val = typeof v?.val === "string" ? v.val.toLowerCase() : "";
    return NSFW_LABELS.has(val);
  });
}

function baseTextFilter(text: string, langsDeclared: boolean): string | null {
  let t = text.replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
  if (t.length > 200 || t.length < 2) return null;
  if (t.startsWith("@") || t.startsWith("RT ")) return null;
  if (t.includes("http://") || t.includes("https://")) return null;
  if (!langsDeclared) {
    const ascii = t.split("").filter((c) => c.charCodeAt(0) < 128).length;
    if (ascii / t.length < 0.7) return null;
  }
  return t;
}

// Construct the CDN URL for an image blob in a post record. Use "fullsize" for
// inline display and "thumbnail" for small link-card previews.
function imageCdnUrl(
  did: string,
  blobRef: any,
  size: "fullsize" | "thumbnail" = "fullsize",
): string | null {
  const cid = blobRef?.ref?.$link ?? blobRef?.ref?.toString?.();
  if (typeof cid !== "string" || !cid) return null;
  return `https://cdn.bsky.app/img/feed_${size}/plain/${did}/${cid}@jpeg`;
}

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

function usableAnyPost(data: any): {
  text: string;
  did: string;
  rkey: string;
  cid?: string;
  replyRootUri?: string;
  replyRootCid?: string;
  embed?: MessageEmbed;
  isNsfw: boolean;
} | null {
  const record = data.commit?.record;
  if (!record) return null;

  const did = data.did as string | undefined;
  if (!did) return null;

  const embed = extractEmbed(record, did);
  const isNsfw = hasNsfwLabel(record);

  if (Array.isArray(record.langs) && record.langs.length > 0) {
    if (!record.langs.some((l: string) => l.toLowerCase().startsWith("en"))) {
      return null;
    }
  }

  // Allow image posts with no text; otherwise require text that passes filter.
  let text = "";
  if (record.text) {
    const filtered = baseTextFilter(record.text, !!record.langs);
    if (!filtered) return null;
    text = filtered;
  } else if (!embed || embed.kind !== "images") {
    return null;
  }

  const rkey = data.commit?.rkey as string | undefined;
  const cid = data.commit?.cid as string | undefined;
  if (!rkey) return null;
  const replyRootUri = record.reply?.root?.uri as string | undefined;
  const replyRootCid = record.reply?.root?.cid as string | undefined;
  return { text, did, rkey, cid, replyRootUri, replyRootCid, embed, isNsfw };
}

function postUri(did: string, rkey: string): string {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

// Renders an image or link-card embed inside a message bubble.
function MessageEmbedView({ embed }: { embed: MessageEmbed }) {
  if (embed.kind === "quote") {
    const quoted = quotedPostResolver.get(embed.uri);
    const appUrl = bskyAppUrlFromUri(embed.uri);
    return (
      <>
        {/* The media belongs to the quoting post, so it sits above the quoted
            card rather than inside it. */}
        {embed.media && <MessageEmbedView embed={embed.media} />}
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
                <div className="quote-author-names">
                  <span className="quote-name">
                    {quoted.authorName || quoted.authorHandle}
                  </span>
                  <span className="quote-handle">@{quoted.authorHandle}</span>
                </div>
              </div>
              {quoted.text && (
                <span className="quote-text">{quoted.text}</span>
              )}
            </>
          ) : (
            <span className="quote-pending">quoted post</span>
          )}
        </a>
      </>
    );
  }

  if (embed.kind === "images") {
    return (
      <div className={`embed-images count-${Math.min(embed.images.length, 4)}`}>
        {embed.images.map((img, i) => (
          <img key={i} src={img.url} alt={img.alt || ""} loading="lazy" />
        ))}
      </div>
    );
  }

  let host = "";
  try {
    host = new URL(embed.uri).hostname.replace(/^www\./, "");
  } catch {
    host = embed.uri;
  }
  return (
    <a
      className="embed-external"
      href={embed.uri}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {embed.thumb && (
        <img className="embed-thumb" src={embed.thumb} alt="" loading="lazy" />
      )}
      <div className="embed-meta">
        <span className="embed-host">{host}</span>
        {embed.title && <span className="embed-title">{embed.title}</span>}
        {embed.description && (
          <span className="embed-desc">{embed.description}</span>
        )}
      </div>
    </a>
  );
}

// ---- Component ------------------------------------------------------------

const MAX_ACCOUNT_CONVOS = 500;
const MAX_GROUP_CONVOS = 500;
const MAX_MESSAGES_PER_CONVO = 120;

const BSKY_APPVIEW = "https://public.api.bsky.app";

// Session-scoped dedupe so we only backfill each thread once
const backfilledThreads = new Set<string>();

interface ThreadNode {
  $type?: string;
  post?: {
    uri: string;
    cid: string;
    author: {
      did: string;
      handle: string;
      displayName?: string;
      avatar?: string;
    };
    record: { text?: string; createdAt?: string; langs?: string[] };
  };
  parent?: ThreadNode;
  replies?: ThreadNode[];
}

function extractThreadPosts(
  node: ThreadNode | undefined,
): NonNullable<ThreadNode["post"]>[] {
  if (!node) return [];
  // Skip "notFoundPost" or "blockedPost" nodes
  if (node.$type && node.$type !== "app.bsky.feed.defs#threadViewPost") {
    return [];
  }
  const out: NonNullable<ThreadNode["post"]>[] = [];
  if (node.parent) out.push(...extractThreadPosts(node.parent));
  if (node.post) out.push(node.post);
  if (Array.isArray(node.replies)) {
    for (const r of node.replies) out.push(...extractThreadPosts(r));
  }
  return out;
}

function rkeyFromUri(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] || "";
}

// LRU-evict from a conversation map, but never evict convos the user has
// replied to. If all convos are protected, skip eviction (soft cap).
function evictOldestUnlocked(map: Map<string, Conversation>): void {
  let oldestId: string | null = null;
  let oldestAt = Infinity;
  for (const [k, v] of map) {
    if (v.userReplied) continue;
    if (v.lastActivity < oldestAt) {
      oldestAt = v.lastActivity;
      oldestId = k;
    }
  }
  if (oldestId) map.delete(oldestId);
}

export function FakeMessages() {
  useDocumentTitle("Messages");
  const [mode, setMode] = useState<MessagesMode>(loadStoredMode);
  const modeRef = useRef(mode);
  const [_profileTick, setProfileTick] = useState(0);

  // Each mode holds its own conversations + active id
  const [accountsConvos, setAccountsConvos] = useState<
    Map<string, Conversation>
  >(new Map());
  const [groupsConvos, setGroupsConvos] = useState<Map<string, Conversation>>(
    new Map(),
  );

  const [accountsActiveId, setAccountsActiveId] = useState<string | null>(null);
  const [groupsActiveId, setGroupsActiveId] = useState<string | null>(null);

  const [inputText, setInputText] = useState("");
  const [showTapback, setShowTapback] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInHandle, setSignInHandle] = useState("");
  const [postStatus, setPostStatus] = useState<
    | { kind: "idle" }
    | { kind: "posting" }
    | { kind: "posted"; uri: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  // Sidebar filter: show only conversations the user has replied to.
  const [showRepliedOnly, setShowRepliedOnly] = useState(false);
  // Whether to allow self-labeled NSFW posts through the firehose intake.
  const [showNsfw, setShowNsfw] = useState(loadStoredShowNsfw);
  const showNsfwRef = useRef(showNsfw);
  // Whether incoming texts play the iMessage chime. The sound module owns the
  // setting (so playback can self-gate); this mirrors it for the toggle UI.
  const [soundEnabled, setSoundEnabled] = useState(isMessageSoundEnabled);
  // Session score: every reply sent (fake or real Bluesky post).
  const [replyTimestamps, setReplyTimestamps] = useState<number[]>([]);
  const [_rateTick, setRateTick] = useState(0);
  const auth = useBskyAuth();

  // Re-render every 5s so the rolling rate display stays fresh
  useEffect(() => {
    const id = setInterval(() => setRateTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const pendingQueue = useRef<PendingDelivery[]>([]);
  const lastFirehoseAt = useRef(0);
  // URIs of replies the user has posted, mapped to {mode, conversationId} so an
  // incoming firehose reply to one of them can be routed back into that chat.
  const myReplyUris = useRef<
    Map<string, { mode: MessagesMode; conversationId: string }>
  >(new Map());

  // Add a tracked reply URI, evicting the oldest once we exceed the cap so the
  // map can't grow without bound over a long session.
  const trackReplyUri = useCallback(
    (uri: string, target: { mode: MessagesMode; conversationId: string }) => {
      const map = myReplyUris.current;
      map.set(uri, target);
      const MAX = 200;
      while (map.size > MAX) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    [],
  );

  // Refs so firehose callback stays stable but reads latest mode/active id
  const activeIdsRef = useRef({
    accounts: accountsActiveId,
    groups: groupsActiveId,
  });

  useEffect(() => {
    modeRef.current = mode;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }, [mode]);

  useEffect(() => {
    showNsfwRef.current = showNsfw;
    try {
      localStorage.setItem(NSFW_STORAGE_KEY, showNsfw ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showNsfw]);

  useEffect(() => {
    activeIdsRef.current = {
      accounts: accountsActiveId,
      groups: groupsActiveId,
    };
  }, [accountsActiveId, groupsActiveId]);

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

  // Auto-scroll on message change / mode switch
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [accountsConvos, groupsConvos, mode]);

  // ---- Delivery ticker: drains pendingQueue, leaving a brief typing beat ----
  // Each message shows its "typing" indicator for a moment before landing. The
  // delay scales down as the backlog grows so a flood of messages keeps
  // arriving rapidly (overwhelming) instead of stalling as stuck "typing".
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (pendingQueue.current.length > 0) {
        const msg = pendingQueue.current.shift()!;
        deliverMessage(msg);
      }
      const backlog = pendingQueue.current.length;
      const delay =
        backlog > 8 ? 120 : backlog > 3 ? 200 : 250 + Math.random() * 250;
      timeout = setTimeout(tick, delay);
    };
    tick();
    return () => clearTimeout(timeout);
  }, []);

  function deliverMessage(p: PendingDelivery) {
    const activeId = activeIdsRef.current[p.mode];
    const setter = p.mode === "accounts" ? setAccountsConvos : setGroupsConvos;

    setter((prev) => {
      const next = new Map(prev);
      const conv = next.get(p.conversationId);
      if (!conv) return prev;

      let authorName: string | undefined;
      let authorColor: string | undefined;
      if (p.authorDid) {
        const prof = profileResolver.peek(p.authorDid);
        authorName = prof?.displayName || prof?.handle || shortDid(p.authorDid);
        authorColor = colorForDid(p.authorDid);
      }

      const nextMessages = [
        ...conv.messages.slice(-(MAX_MESSAGES_PER_CONVO - 1)),
        {
          id: `${p.conversationId}-${Date.now()}-${Math.random()}`,
          text: p.text,
          timestamp: p.timestamp,
          fromContact: true,
          sourceDid: p.did,
          sourceRkey: p.rkey,
          sourceCid: p.cid,
          sourceUri: postUri(p.did, p.rkey),
          embed: p.embed,
          authorDid: p.authorDid,
          authorName,
          authorColor,
        },
      ];

      const updated: Conversation = {
        ...conv,
        messages: nextMessages,
        isTyping: false,
        lastActivity: p.timestamp,
        unreadCount:
          p.conversationId !== activeId
            ? conv.unreadCount + 1
            : conv.unreadCount,
      };
      next.set(p.conversationId, updated);
      return next;
    });

    // Chime like iMessage on receive. After the state update so audio can
    // never block delivery (a throw here would strand the convo on "typing").
    playMessageSound();
  }

  // ---- Mode-specific firehose handling ---------------------------------

  const handleAccountsFirehose = useCallback((data: any) => {
    const post = usableAnyPost(data);
    if (!post) return;
    // Skip self-labeled NSFW unless the user has opted in.
    if (post.isNsfw && !showNsfwRef.current) return;
    // Fresh posts only: a reply was directed at someone else, so it reads as
    // a non-sequitur when shown as that account texting you directly.
    if (post.replyRootUri) return;
    profileResolver.get(post.did);

    // Route post to the author's own conversation
    setAccountsConvos((prev) => {
      const next = new Map(prev);
      const existing = next.get(post.did);
      const prof = profileResolver.peek(post.did);
      const displayName =
        prof?.displayName || prof?.handle || shortDid(post.did);
      const subtitle = prof?.handle ? `@${prof.handle}` : undefined;

      if (existing) {
        next.set(post.did, {
          ...existing,
          displayName,
          subtitle,
          avatarUrl: prof?.avatar,
          isTyping: true,
        });
      } else {
        if (next.size >= MAX_ACCOUNT_CONVOS) {
          evictOldestUnlocked(next);
        }
        next.set(post.did, {
          id: post.did,
          kind: "accounts",
          displayName,
          subtitle,
          avatarColor: colorForDid(post.did),
          avatarInitial: (displayName[0] || "?").toUpperCase(),
          avatarUrl: prof?.avatar,
          messages: [],
          unreadCount: 0,
          isTyping: true,
          lastActivity: Date.now(),
        });
      }
      return next;
    });

    // Queue this post for delivery into the author's conversation
    pendingQueue.current.push({
      mode: "accounts",
      conversationId: post.did,
      text: post.text,
      timestamp: Date.now(),
      did: post.did,
      rkey: post.rkey,
      cid: post.cid,
      embed: post.embed,
    });
  }, []);

  const backfillThread = useCallback(async (rootUri: string) => {
    if (backfilledThreads.has(rootUri)) return;
    backfilledThreads.add(rootUri);

    try {
      const url =
        `${BSKY_APPVIEW}/xrpc/app.bsky.feed.getPostThread` +
        `?uri=${encodeURIComponent(rootUri)}&depth=10&parentHeight=0`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: ThreadNode };
      const posts = extractThreadPosts(data.thread);
      if (posts.length === 0) return;

      // Seed profile cache with the hydrated authors from the thread response
      for (const p of posts) {
        profileResolver.hydrate({
          did: p.author.did,
          handle: p.author.handle,
          displayName: p.author.displayName,
          avatar: p.author.avatar,
        });
      }

      const participants = new Set<string>(posts.map((p) => p.author.did));
      // Only promote to a visible group chat if thread has ≥2 participants
      if (participants.size < 2) return;

      const messages: Message[] = posts
        .map((p) => {
          const text = typeof p.record?.text === "string" ? p.record.text : "";
          const filtered = baseTextFilter(text, !!p.record?.langs);
          const finalText = filtered ?? text.trim();
          if (!finalText) return null;
          const ts = p.record?.createdAt
            ? new Date(p.record.createdAt).getTime()
            : Date.now();
          return {
            id: `thread-${p.uri}`,
            text: finalText,
            timestamp: ts,
            fromContact: true,
            sourceDid: p.author.did,
            sourceRkey: rkeyFromUri(p.uri),
            sourceCid: p.cid,
            sourceUri: p.uri,
            authorDid: p.author.did,
            authorName: p.author.displayName || p.author.handle,
            authorColor: colorForDid(p.author.did),
          } as Message;
        })
        .filter((m): m is Message => m !== null)
        .sort((a, b) => a.timestamp - b.timestamp);

      setGroupsConvos((prev) => {
        const next = new Map(prev);
        const existing = next.get(rootUri);

        // Merge with any existing messages (dedup by id)
        const seenIds = new Set((existing?.messages || []).map((m) => m.id));
        const merged = [
          ...(existing?.messages || []),
          ...messages.filter((m) => !seenIds.has(m.id)),
        ]
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-MAX_MESSAGES_PER_CONVO);

        const mergedParticipants = new Set<string>(
          existing?.participants || [],
        );
        for (const did of participants) mergedParticipants.add(did);

        const names = namesForParticipants(mergedParticipants);

        // LRU evict if over cap
        if (!existing && next.size >= MAX_GROUP_CONVOS) {
          evictOldestUnlocked(next);
        }

        // The root post's CID is whichever backfilled post matches the root URI
        const rootPost = posts.find((p) => p.uri === rootUri);
        const rootCid = rootPost?.cid || existing?.rootCid;

        next.set(rootUri, {
          id: rootUri,
          kind: "groups",
          displayName: names.display,
          subtitle: names.subtitle,
          avatarColor: colorForDid(Array.from(mergedParticipants)[0]),
          avatarInitial: names.display[0]?.toUpperCase() || "?",
          participants: mergedParticipants,
          rootUri,
          rootCid,
          messages: merged,
          unreadCount: existing?.unreadCount || 0,
          isTyping: false,
          lastActivity: Date.now(),
        });
        return next;
      });
    } catch (e) {
      console.error("thread backfill failed", e);
    }
  }, []);

  const handleGroupsFirehose = useCallback((data: any) => {
    const post = usableAnyPost(data);
    if (!post) return;
    // Skip self-labeled NSFW unless the user has opted in.
    if (post.isNsfw && !showNsfwRef.current) return;
    // Root URI: replies use reply.root.uri; originals use their own uri
    const rootUri = post.replyRootUri || postUri(post.did, post.rkey);
    // For originals, the root CID is this post's CID; for replies it's the
    // reply.root.cid from the record (always present on valid replies)
    const rootCid = post.replyRootCid || post.cid;

    profileResolver.get(post.did);

    setGroupsConvos((prev) => {
      const next = new Map(prev);
      const existing = next.get(rootUri);

      if (existing) {
        const participants = new Set(existing.participants);
        participants.add(post.did);
        const names = namesForParticipants(participants);
        next.set(rootUri, {
          ...existing,
          participants,
          displayName: names.display,
          subtitle: names.subtitle,
          avatarColor: colorForDid(Array.from(participants)[0]),
          avatarInitial: names.display[0]?.toUpperCase() || "?",
          rootUri,
          rootCid: existing.rootCid || rootCid,
          isTyping: true,
        });
      } else {
        // Only create a bucket if it's an original post (we may add repliers later)
        // or if it's a reply (we'll seed the thread from here)
        if (next.size >= MAX_GROUP_CONVOS) {
          evictOldestUnlocked(next);
        }
        const participants = new Set<string>([post.did]);
        const names = namesForParticipants(participants);
        next.set(rootUri, {
          id: rootUri,
          kind: "groups",
          displayName: names.display,
          subtitle: names.subtitle,
          avatarColor: colorForDid(post.did),
          avatarInitial: names.display[0]?.toUpperCase() || "?",
          participants,
          rootUri,
          rootCid,
          messages: [],
          unreadCount: 0,
          isTyping: true,
          lastActivity: Date.now(),
        });
      }
      return next;
    });

    pendingQueue.current.push({
      mode: "groups",
      conversationId: rootUri,
      text: post.text,
      timestamp: Date.now(),
      did: post.did,
      rkey: post.rkey,
      cid: post.cid,
      authorDid: post.did,
    });
  }, []);

  // If this firehose post is a reply to one of the user's own posted replies,
  // route it back into that conversation as an incoming message and start
  // tracking it, so an ongoing back-and-forth keeps landing. Returns true when
  // handled (so the normal intake path can skip it).
  const routeReplyToMe = useCallback((data: any): boolean => {
    const parentUri = data.commit?.record?.reply?.parent?.uri;
    if (typeof parentUri !== "string") return false;
    const target = myReplyUris.current.get(parentUri);
    if (!target) return false;

    const post = usableAnyPost(data);
    if (!post) return false;
    // Respect the NSFW toggle here too — an unsolicited reply could carry a
    // label the user has chosen not to see. Return true so the post is still
    // consumed (not re-routed through the normal intake path).
    if (post.isNsfw && !showNsfwRef.current) return true;

    // In Accounts mode each conversation is a single account. A reply to your
    // post from someone other than that account reads as a non-sequitur, so we
    // consume it (return true) without routing it into the chat. Groups mode is
    // intentionally multi-person, so it keeps every replier.
    if (target.mode === "accounts" && post.did !== target.conversationId) {
      return true;
    }

    profileResolver.get(post.did);
    pendingQueue.current.unshift({
      mode: target.mode,
      conversationId: target.conversationId,
      text: post.text,
      timestamp: Date.now(),
      did: post.did,
      rkey: post.rkey,
      cid: post.cid,
      embed: post.embed,
      authorDid: post.did,
    });
    // Track this new reply too, so the thread can continue.
    trackReplyUri(postUri(post.did, post.rkey), target);
    // Surface a typing indicator on that conversation immediately.
    const setter =
      target.mode === "accounts" ? setAccountsConvos : setGroupsConvos;
    setter((prev) => {
      const conv = prev.get(target.conversationId);
      if (!conv) return prev;
      const next = new Map(prev);
      next.set(target.conversationId, { ...conv, isTyping: true });
      return next;
    });
    return true;
  }, [trackReplyUri]);

  const handleFirehose = useCallback(
    (data: any) => {
      // A reply to something the user posted is high-signal and rare — route it
      // back into the conversation, bypassing the intake throttle entirely.
      if (routeReplyToMe(data)) return;

      // In Groups mode, trigger thread backfill on every reply we observe —
      // regardless of intake throttle. Jetstream alone rarely gives us ≥2
      // participants in the same thread during a session, so we grab the
      // whole thread via getPostThread the first time we see its root.
      if (modeRef.current === "groups") {
        const replyRoot = data.commit?.record?.reply?.root?.uri;
        if (typeof replyRoot === "string") {
          void backfillThread(replyRoot);
        }
      }

      const now = Date.now();
      // Per-mode intake throttle. The firehose supplies ~50 eligible fresh
      // posts/sec; without this the sidebar would be unusably fast. Kept low so
      // messages still pour in. The delivery ticker (caps ~8/sec under load)
      // and backpressure guard below keep intake drainable.
      // - Accounts: a new contact roughly every ~150ms (~6.5/sec)
      // - Groups: medium so threads have room to accumulate replies
      const minGap = modeRef.current === "accounts" ? 150 : 400;
      if (now - lastFirehoseAt.current < minGap) return;

      // Backpressure: bound the delivery backlog. Past this, drop new intake
      // rather than queuing messages that would land long after the firehose
      // post that spawned them (and never let the queue grow without limit).
      if (pendingQueue.current.length > 20) return;

      switch (modeRef.current) {
        case "accounts":
          handleAccountsFirehose(data);
          break;
        case "groups":
          handleGroupsFirehose(data);
          break;
      }
      lastFirehoseAt.current = now;
    },
    [
      handleAccountsFirehose,
      handleGroupsFirehose,
      backfillThread,
      routeReplyToMe,
    ],
  );

  useJetStream({
    wantedCollections: ["app.bsky.feed.post"],
    onMessage: handleFirehose,
    onConnectionChange: () => {},
  });

  // ---- Derived current-mode state --------------------------------------

  const currentConvos = mode === "accounts" ? accountsConvos : groupsConvos;
  const currentActiveId =
    mode === "accounts" ? accountsActiveId : groupsActiveId;
  const setCurrentActiveId =
    mode === "accounts"
      ? (id: string | null) => setAccountsActiveId(id)
      : (id: string | null) => setGroupsActiveId(id);
  const setCurrentConvos =
    mode === "accounts" ? setAccountsConvos : setGroupsConvos;

  // For groups mode: only show conversations with >=2 participants.
  // When the filter is on, also restrict to conversations the user replied to.
  const visibleConvos = Array.from(currentConvos.values()).filter((c) => {
    if (showRepliedOnly && !c.userReplied) return false;
    if (c.kind !== "groups") return true;
    return (c.participants?.size || 0) >= 2;
  });

  const repliedCount = Array.from(currentConvos.values()).filter(
    (c) => c.userReplied,
  ).length;

  // Promote resolved profiles into conversation display names (accounts mode)
  useEffect(() => {
    if (mode !== "accounts") return;
    setAccountsConvos((prev) => {
      let dirty = false;
      const next = new Map(prev);
      for (const [did, conv] of prev) {
        const prof = profileResolver.peek(did);
        if (!prof) continue;
        const display = prof.displayName || prof.handle;
        const subtitle = `@${prof.handle}`;
        if (conv.displayName !== display || conv.avatarUrl !== prof.avatar) {
          next.set(did, {
            ...conv,
            displayName: display,
            subtitle,
            avatarUrl: prof.avatar,
            avatarInitial: (display[0] || "?").toUpperCase(),
          });
          dirty = true;
        }
      }
      return dirty ? next : prev;
    });
  }, [_profileTick, mode]);

  // Promote resolved profiles into group names (groups mode)
  useEffect(() => {
    if (mode !== "groups") return;
    setGroupsConvos((prev) => {
      let dirty = false;
      const next = new Map(prev);
      for (const [id, conv] of prev) {
        if (!conv.participants || conv.participants.size === 0) continue;
        const names = namesForParticipants(conv.participants);
        if (
          conv.displayName !== names.display ||
          conv.subtitle !== names.subtitle
        ) {
          next.set(id, {
            ...conv,
            displayName: names.display,
            subtitle: names.subtitle,
            avatarInitial: names.display[0]?.toUpperCase() || "?",
          });
          dirty = true;
        }
      }
      return dirty ? next : prev;
    });
  }, [_profileTick, mode]);

  const activeConversation = currentActiveId
    ? currentConvos.get(currentActiveId)
    : undefined;

  // ---- User actions ----------------------------------------------------

  // Find the most recent incoming message in the active conversation — this is
  // the target we reply to if the user is signed in on Bluesky.
  function getReplyTarget(): ReplyTarget | null {
    if (!activeConversation) return null;
    const lastIncoming = [...activeConversation.messages]
      .reverse()
      .find((m) => m.fromContact);
    if (!lastIncoming?.sourceDid || !lastIncoming.sourceRkey) return null;
    if (!lastIncoming.sourceCid) return null;
    const parentUri =
      lastIncoming.sourceUri ||
      postUri(lastIncoming.sourceDid, lastIncoming.sourceRkey);
    // For groups mode, the root is the thread root. For others, root = parent.
    const rootUri =
      activeConversation.rootUri && activeConversation.rootCid
        ? activeConversation.rootUri
        : parentUri;
    const rootCid =
      activeConversation.rootUri && activeConversation.rootCid
        ? activeConversation.rootCid
        : lastIncoming.sourceCid;
    return {
      rootUri,
      rootCid,
      parentUri,
      parentCid: lastIncoming.sourceCid,
    };
  }

  const replyTarget = getReplyTarget();
  const canPostToBluesky =
    auth.state.status === "signed-in" && replyTarget !== null;

  const handleSend = async () => {
    if (!inputText.trim() || !currentActiveId) return;
    const text = inputText.trim();

    // Local echo first — so the message appears in the UI immediately.
    // Also mark the convo as userReplied so LRU won't evict it.
    setCurrentConvos((prev) => {
      const next = new Map(prev);
      const conv = next.get(currentActiveId);
      if (!conv) return prev;
      next.set(currentActiveId, {
        ...conv,
        messages: [
          ...conv.messages,
          {
            id: `user-${Date.now()}`,
            text,
            timestamp: Date.now(),
            fromContact: false,
          },
        ],
        lastActivity: Date.now(),
        userReplied: true,
      });
      return next;
    });
    setInputText("");
    // Count every reply toward the session score, fake or real.
    setReplyTimestamps((ts) => [...ts, Date.now()]);

    // If signed in and we have a reply target, actually post to Bluesky
    if (canPostToBluesky && replyTarget) {
      setPostStatus({ kind: "posting" });
      try {
        const uri = await postReply(text, replyTarget);
        setPostStatus({ kind: "posted", uri });
        // Track this reply so a response to it can be routed back into the chat.
        trackReplyUri(uri, {
          mode: modeRef.current,
          conversationId: currentActiveId,
        });
        setCurrentConvos((prev) => {
          const next = new Map(prev);
          const conv = next.get(currentActiveId);
          if (!conv) return prev;
          next.set(currentActiveId, {
            ...conv,
            realReplies: (conv.realReplies || 0) + 1,
          });
          return next;
        });
        setTimeout(() => {
          setPostStatus((s) => (s.kind === "posted" ? { kind: "idle" } : s));
        }, 4000);
      } catch (e) {
        setPostStatus({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  };

  const handleSignIn = async (handle: string) => {
    const h = handle.trim();
    if (!h) return;
    try {
      await auth.signIn(h);
    } catch (e) {
      setPostStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleSelectConversation = (id: string) => {
    setCurrentActiveId(id);
    setShowTapback(null);
    // Focus the composer so you can immediately type after navigating
    // (whether by click or arrow keys).
    requestAnimationFrame(() => inputRef.current?.focus());
    setCurrentConvos((prev) => {
      const next = new Map(prev);
      const conv = next.get(id);
      if (!conv) return prev;
      if (conv.unreadCount === 0) return prev;
      next.set(id, { ...conv, unreadCount: 0 });
      return next;
    });
  };

  const handleTapback = (messageId: string, reaction: string) => {
    if (!currentActiveId) return;
    setCurrentConvos((prev) => {
      const next = new Map(prev);
      const conv = next.get(currentActiveId);
      if (!conv) return prev;
      next.set(currentActiveId, {
        ...conv,
        messages: conv.messages.map((m) =>
          m.id === messageId
            ? { ...m, reaction: m.reaction === reaction ? undefined : reaction }
            : m,
        ),
      });
      return next;
    });
    setShowTapback(null);
  };

  const handleModeChange = (next: MessagesMode) => {
    setMode(next);
    setShowTapback(null);
    pendingQueue.current = [];
  };

  // ---- Sort & totals ---------------------------------------------------

  const sortedConvos = visibleConvos.sort((a, b) => {
    if (a.isTyping && !b.isTyping) return -1;
    if (!a.isTyping && b.isTyping) return 1;
    const aLast = a.messages.length
      ? a.messages[a.messages.length - 1].timestamp
      : a.lastActivity;
    const bLast = b.messages.length
      ? b.messages[b.messages.length - 1].timestamp
      : b.lastActivity;
    return bLast - aLast;
  });

  const totalUnread = sortedConvos.reduce((s, c) => s + c.unreadCount, 0);

  const placeholder =
    mode === "accounts" ? "reply to this DM..." : "send to the group...";

  // Keyboard navigation: ↑/↓ to move between conversations, Esc to focus input
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Mobile edge-swipe: a drag starting at the left edge of the chat pane
  // follows the finger and, past a threshold, returns to the conversation
  // list. We mutate the root's CSS vars/classes directly so the drag stays
  // smooth without re-rendering on every touchmove.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Only relevant while a conversation is open (chat is showing).
    if (!currentActiveId) return;

    const EDGE_PX = 30; // start zone from the left edge
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let decided = false; // whether we've committed to a horizontal drag

    const reset = () => {
      root.classList.remove("dragging");
      root.style.removeProperty("--drag-x");
      dragging = false;
      decided = false;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) return; // not an edge swipe
      startX = t.clientX;
      startY = t.clientY;
      dragging = true;
      decided = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!decided) {
        // Ignore vertical-dominant gestures so list scrolling still works.
        if (Math.abs(dy) > Math.abs(dx)) {
          dragging = false;
          return;
        }
        if (Math.abs(dx) < 8) return; // wait until intent is clear
        decided = true;
        root.classList.add("dragging");
      }
      // Only track rightward drags (back toward the list).
      const clamped = Math.max(0, dx);
      e.preventDefault();
      root.style.setProperty("--drag-x", `${clamped}px`);
    };

    const onEnd = () => {
      if (!dragging || !decided) {
        reset();
        return;
      }
      const dragX = parseFloat(
        getComputedStyle(root).getPropertyValue("--drag-x"),
      );
      reset();
      // Past a third of the viewport → commit to the list view. Call the
      // mode-specific setter directly so this effect doesn't depend on the
      // per-render `setCurrentActiveId` identity (which would re-subscribe the
      // touch listeners on every firehose-driven render).
      if (dragX > window.innerWidth / 3) {
        if (modeRef.current === "accounts") setAccountsActiveId(null);
        else setGroupsActiveId(null);
      }
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onEnd);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
      reset();
    };
  }, [currentActiveId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";
      // Arrow nav works from the list, and from the (auto-focused) composer
      // only while it's empty — so an in-progress draft keeps normal cursor
      // movement instead of jumping conversations.
      const canArrowNav = !isInput || inputText.length === 0;

      if (canArrowNav && (e.key === "ArrowUp" || (e.key === "j" && !isInput))) {
        e.preventDefault();
        const idx = sortedConvos.findIndex((c) => c.id === currentActiveId);
        const prev = idx > 0 ? idx - 1 : sortedConvos.length - 1;
        if (sortedConvos[prev]) handleSelectConversation(sortedConvos[prev].id);
      } else if (
        canArrowNav &&
        (e.key === "ArrowDown" || (e.key === "k" && !isInput))
      ) {
        e.preventDefault();
        const idx = sortedConvos.findIndex((c) => c.id === currentActiveId);
        const next = idx < sortedConvos.length - 1 ? idx + 1 : 0;
        if (sortedConvos[next]) handleSelectConversation(sortedConvos[next].id);
      } else if (e.key === "Escape" && isInput) {
        (e.target as HTMLElement).blur();
      } else if ((e.key === "i" || e.key === "/") && !isInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sortedConvos, currentActiveId, handleSelectConversation, inputText]);

  return (
    <div
      ref={rootRef}
      className={`fake-messages ${currentActiveId ? "viewing-chat" : ""}`}
    >
      <div className="messages-track">
        <div className="messages-sidebar">
          <div className="sidebar-header">
            <Link to="/" className="back-button">
              &lsaquo;
            </Link>
            <h1>@Messages</h1>
            {totalUnread > 0 && (
              <span className="total-unread">{totalUnread}</span>
            )}
          </div>
          <div className="auth-bar">
            {auth.state.status === "signed-in" ? (
              <>
                <span className="auth-dot" aria-hidden />
                <span className="auth-handle">
                  @{auth.state.handle || "signed in"}
                </span>
                <button
                  className="auth-action"
                  onClick={() => auth.signOut()}
                  type="button"
                >
                  sign out
                </button>
              </>
            ) : signInOpen ? (
              <form
                className="auth-signin-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSignIn(signInHandle);
                }}
              >
                <input
                  type="text"
                  value={signInHandle}
                  onChange={(e) => setSignInHandle(e.target.value)}
                  placeholder="yourhandle.bsky.social"
                  autoFocus
                />
                <button type="submit">→</button>
                <button
                  type="button"
                  onClick={() => setSignInOpen(false)}
                  className="auth-cancel"
                >
                  cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="auth-action primary"
                onClick={() => setSignInOpen(true)}
                disabled={auth.state.status === "loading"}
              >
                {auth.state.status === "loading"
                  ? "loading…"
                  : "sign in to reply on bluesky"}
              </button>
            )}
          </div>
          {replyTimestamps.length > 0 &&
            (() => {
              const now = Date.now();
              const last60 = replyTimestamps.filter(
                (t) => now - t < 60_000,
              ).length;
              const firstAt = replyTimestamps[0];
              const elapsedMin = Math.max((now - firstAt) / 60_000, 1 / 60);
              const avg = replyTimestamps.length / elapsedMin;
              return (
                <div className="score-bar" aria-live="polite">
                  <div className="score-main">
                    <span className="score-value">
                      {replyTimestamps.length}
                    </span>
                    <span className="score-label">
                      {replyTimestamps.length === 1
                        ? "reply sent"
                        : "replies sent"}
                    </span>
                  </div>
                  <div className="score-rate">
                    <span className="rate-now">{last60}/min now</span>
                    <span className="rate-divider">·</span>
                    <span className="rate-avg">avg {avg.toFixed(1)}/min</span>
                  </div>
                </div>
              );
            })()}
          <div className="mode-switcher" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "accounts"}
              className={`mode-tab ${mode === "accounts" ? "active" : ""}`}
              onClick={() => handleModeChange("accounts")}
              title="Every Bluesky account becomes its own contact"
            >
              DMs
            </button>
            <button
              role="tab"
              aria-selected={mode === "groups"}
              className={`mode-tab ${mode === "groups" ? "active" : ""}`}
              onClick={() => handleModeChange("groups")}
              title="Real Bluesky threads rendered as group chats"
            >
              Groups
            </button>
          </div>

          {(repliedCount > 0 || showRepliedOnly) && (
            <div className="sidebar-filters">
              <button
                className={`filter-pill ${showRepliedOnly ? "active" : ""}`}
                onClick={() => setShowRepliedOnly((v) => !v)}
                title="Show only conversations you've replied to"
              >
                {showRepliedOnly ? "← show all" : `★ replied (${repliedCount})`}
              </button>
            </div>
          )}

          <div className="conversation-list">
            {sortedConvos.length === 0 && (
              <div className="empty-list">
                {mode === "accounts"
                  ? "Waiting for DMs to come in..."
                  : "Waiting for conversations to form..."}
              </div>
            )}
            {sortedConvos.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${conv.id === currentActiveId ? "active" : ""} ${conv.userReplied ? "replied" : ""}`}
                onClick={() => handleSelectConversation(conv.id)}
              >
                <ConversationAvatar conv={conv} />
                <div className="conversation-preview">
                  <div className="conversation-top">
                    <span className="contact-name">
                      {conv.userReplied && (
                        <span className="replied-star" title="You replied">
                          ★{" "}
                        </span>
                      )}
                      {conv.displayName}
                    </span>
                    {conv.messages.length > 0 && (
                      <span className="message-time">
                        {dayjs(
                          conv.messages[conv.messages.length - 1].timestamp,
                        ).format("h:mm A")}
                      </span>
                    )}
                  </div>
                  {conv.subtitle && (
                    <div className="conversation-subtitle">{conv.subtitle}</div>
                  )}
                  <div className="conversation-bottom">
                    <span className="last-message">
                      {conv.isTyping ? (
                        <em className="typing-preview">typing...</em>
                      ) : conv.messages.length > 0 ? (
                        renderPreview(conv)
                      ) : null}
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="unread-badge">{conv.unreadCount}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="keyboard-hints">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> send
            </span>
            <span>
              <kbd>esc</kbd> unfocus
            </span>
          </div>
        </div>

        <div className="messages-main">
          <div className="header-toggles">
            <button
              className={`header-toggle ${soundEnabled ? "active" : ""}`}
              onClick={() => {
                const next = !soundEnabled;
                setMessageSoundEnabled(next);
                setSoundEnabled(next);
                // Clicking is a user gesture — preview the chime when enabling so
                // browser autoplay unlocks and the user hears what it sounds like.
                if (next) playMessageSound();
              }}
              title={
                soundEnabled
                  ? "Message sound is on — click to mute"
                  : "Play a sound on each incoming message"
              }
            >
              {soundEnabled ? "🔊 sound" : "🔇 sound"}
            </button>
            <button
              className={`header-toggle nsfw-toggle ${showNsfw ? "active" : ""}`}
              onClick={() => setShowNsfw((v) => !v)}
              title={
                showNsfw
                  ? "NSFW content is showing — click to hide"
                  : "Show self-labeled NSFW content"
              }
            >
              {showNsfw ? "NSFW: on" : "NSFW: off"}
            </button>
          </div>
          {activeConversation ? (
            <>
              <div className="chat-header">
                <button
                  type="button"
                  className="chat-back-button"
                  onClick={() => setCurrentActiveId(null)}
                  aria-label="Back to conversations"
                >
                  &lsaquo;
                </button>
                {(() => {
                  const profileUrl = conversationBskyUrl(activeConversation);
                  const inner = (
                    <>
                      <ConversationAvatar conv={activeConversation} small />
                      <div className="chat-header-text">
                        <span className="chat-contact-name">
                          {activeConversation.displayName}
                        </span>
                        {activeConversation.subtitle && (
                          <span className="chat-subtitle">
                            {activeConversation.subtitle}
                          </span>
                        )}
                      </div>
                    </>
                  );
                  return profileUrl ? (
                    <a
                      className="chat-header-link"
                      href={profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={
                        activeConversation.kind === "accounts"
                          ? "Open profile on Bluesky"
                          : "Open thread on Bluesky"
                      }
                    >
                      {inner}
                    </a>
                  ) : (
                    inner
                  );
                })()}
              </div>

              <div
                className="messages-body"
                onClick={() => setShowTapback(null)}
              >
                <div className="messages-date-header">Today</div>
                {activeConversation.messages.map((msg, i) => {
                  const prev = activeConversation.messages[i - 1];
                  const showTs =
                    !prev || msg.timestamp - prev.timestamp > 300000;
                  // Show author name above bubble when:
                  // - Groups mode: always for incoming from different authors
                  // - Accounts mode: when the message is from someone OTHER than
                  //   the account this conversation belongs to (thread context)
                  const isThirdParty =
                    activeConversation.kind === "accounts" &&
                    msg.authorDid &&
                    msg.authorDid !== activeConversation.id;
                  const showAuthorLabel =
                    msg.fromContact &&
                    msg.authorName &&
                    (activeConversation.kind === "groups" || isThirdParty) &&
                    (!prev ||
                      prev.authorDid !== msg.authorDid ||
                      !prev.fromContact);
                  return (
                    <div key={msg.id}>
                      {showTs && i > 0 && (
                        <div className="message-timestamp">
                          {dayjs(msg.timestamp).format("h:mm A")}
                        </div>
                      )}
                      {showAuthorLabel && (
                        <div
                          className="author-label"
                          style={{ color: msg.authorColor }}
                        >
                          {msg.authorName}
                        </div>
                      )}
                      <div
                        className={`message-row ${msg.fromContact ? "incoming" : "outgoing"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowTapback(
                            showTapback === msg.id ? null : msg.id,
                          );
                        }}
                      >
                        {(msg.text || !msg.embed) && (
                          <div
                            className={`message-bubble ${msg.fromContact ? "incoming" : "outgoing"}`}
                          >
                            <span className="message-text">{msg.text}</span>
                            {!msg.embed && msg.reaction && (
                              <span className="message-reaction">
                                {msg.reaction}
                              </span>
                            )}
                          </div>
                        )}
                        {msg.embed && (
                          <div className="message-embed">
                            <MessageEmbedView embed={msg.embed} />
                            {msg.reaction && (
                              <span className="message-reaction">
                                {msg.reaction}
                              </span>
                            )}
                          </div>
                        )}
                        {msg.fromContact && msg.sourceDid && msg.sourceRkey && (
                          <a
                            className="source-link"
                            href={`https://bsky.app/profile/${msg.sourceDid}/post/${msg.sourceRkey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View original post on Bluesky"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ↗
                          </a>
                        )}
                        {showTapback === msg.id && (
                          <div className="tapback-menu">
                            {TAPBACK_REACTIONS.map((r) => (
                              <button
                                key={r}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTapback(msg.id, r);
                                }}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {activeConversation.isTyping && (
                  <div className="message-row incoming">
                    <div className="typing-indicator">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {canPostToBluesky && replyTarget && (
                <div className="reply-indicator">
                  <span className="reply-dot" />
                  your next send will post as a real reply to{" "}
                  <a
                    href={replyTargetLink(replyTarget)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="reply-link"
                  >
                    this post ↗
                  </a>
                </div>
              )}
              {postStatus.kind === "posting" && (
                <div className="post-status posting">posting to bluesky…</div>
              )}
              {postStatus.kind === "posted" && (
                <div className="post-status posted">
                  posted.{" "}
                  <a
                    href={bskyAppUrlFromUri(postStatus.uri)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    view on bluesky ↗
                  </a>
                </div>
              )}
              {postStatus.kind === "error" && (
                <div className="post-status error">
                  failed to post: {postStatus.message}
                </div>
              )}
              <div className="message-input-area">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder={
                    canPostToBluesky ? "reply to this post..." : placeholder
                  }
                  className="message-input"
                />
                <button
                  className="send-button"
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                >
                  &uarr;
                </button>
              </div>
            </>
          ) : (
            <div className="messages-empty-state">
              <p>
                {mode === "accounts"
                  ? "No DMs yet. The firehose will fill this up shortly."
                  : "No conversation has formed yet. Group chats appear once a thread has at least two participants."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Small helpers --------------------------------------------------------

function bskyAppUrlFromUri(uri: string): string {
  // at://did:plc:xyz/app.bsky.feed.post/abc -> https://bsky.app/profile/did:plc:xyz/post/abc
  const match = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
  if (!match) return uri;
  return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
}

// The Bluesky link for a conversation header: the account's profile in accounts
// mode; the thread on bsky.app in groups mode. Null if neither applies.
function conversationBskyUrl(conv: Conversation): string | null {
  if (conv.kind === "accounts") {
    return `https://bsky.app/profile/${conv.id}`;
  }
  if (conv.rootUri) {
    return bskyAppUrlFromUri(conv.rootUri);
  }
  return null;
}

function replyTargetLink(r: ReplyTarget): string {
  return bskyAppUrlFromUri(r.parentUri);
}

function shortDid(did: string): string {
  // did:plc:xxxxx → xxxxx…
  const parts = did.split(":");
  const last = parts[parts.length - 1] || did;
  return last.slice(0, 8);
}

function namesForParticipants(participants: Set<string>): {
  display: string;
  subtitle: string;
} {
  const dids = Array.from(participants);
  const resolved = dids.map((d) => {
    const p = profileResolver.peek(d);
    return p?.displayName || p?.handle || shortDid(d);
  });
  const display =
    resolved.slice(0, 2).join(", ") +
    (resolved.length > 2 ? ` + ${resolved.length - 2}` : "");
  const subtitle =
    resolved.length >= 2 ? `${resolved.length} people` : "1 person";
  return { display, subtitle };
}

function renderPreview(conv: Conversation) {
  const last = conv.messages[conv.messages.length - 1];
  if (!last) return null;
  const prefix =
    conv.kind === "groups" && last.fromContact && last.authorName ? (
      <span className="you-prefix" style={{ color: last.authorColor }}>
        {last.authorName}:{" "}
      </span>
    ) : !last.fromContact ? (
      <span className="you-prefix">You: </span>
    ) : null;
  // When the message has no text, describe its attachment like iMessage does.
  let snippet: string;
  if (last.text) {
    snippet = last.text.slice(0, 35) + (last.text.length > 35 ? "\u2026" : "");
  } else if (last.embed?.kind === "images") {
    const n = last.embed.images.length;
    snippet = `\ud83d\udcf7 ${n} ${n === 1 ? "Image" : "Images"}`;
  } else if (last.embed?.kind === "external") {
    snippet = "\ud83d\udd17 Link";
  } else if (last.embed?.kind === "quote") {
    snippet = "\ud83d\udcac Quoted post";
  } else {
    snippet = "";
  }
  return (
    <>
      {prefix}
      {snippet}
    </>
  );
}

function ConversationAvatar({
  conv,
  small,
}: {
  conv: Conversation;
  small?: boolean;
}) {
  const size = small ? "small" : "";
  if (conv.avatarUrl) {
    return (
      <img
        className={`contact-avatar ${size} image`}
        src={conv.avatarUrl}
        alt={conv.displayName}
      />
    );
  }
  if (
    conv.kind === "groups" &&
    conv.participants &&
    conv.participants.size > 1
  ) {
    const participants = Array.from(conv.participants).slice(0, 3);
    return (
      <div className={`contact-avatar ${size} group`}>
        {participants.map((did, i) => {
          const prof = profileResolver.peek(did);
          const color = colorForDid(did);
          const initial = (prof?.displayName || prof?.handle || "?")[0];
          return (
            <div
              key={did}
              className={`group-avatar-tile tile-${i}`}
              style={{
                backgroundColor: prof?.avatar ? "transparent" : color,
                backgroundImage: prof?.avatar
                  ? `url(${prof.avatar})`
                  : undefined,
              }}
            >
              {!prof?.avatar && initial.toUpperCase()}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div
      className={`contact-avatar ${size}`}
      style={{ backgroundColor: conv.avatarColor }}
    >
      {conv.avatarInitial}
    </div>
  );
}
