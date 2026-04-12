import { useState, useCallback, useRef, useEffect } from "react";
import { useJetStream } from "../hooks/useJetStream";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { profileResolver } from "./profileResolver";
import "./FakeMessages.scss";

type MessagesMode = "friends" | "accounts" | "groups";

const TAPBACK_REACTIONS = [
  "\u2764\uFE0F",
  "\uD83D\uDC4D",
  "\uD83D\uDC4E",
  "\uD83D\uDE02",
  "\u203C\uFE0F",
  "\u2753",
];

const MODE_STORAGE_KEY = "hah.messages.mode";

function loadStoredMode(): MessagesMode {
  if (typeof localStorage === "undefined") return "friends";
  const raw = localStorage.getItem(MODE_STORAGE_KEY);
  if (raw === "friends" || raw === "accounts" || raw === "groups") return raw;
  return "friends";
}

// ---- Friends mode ---------------------------------------------------------

const FRIEND_CONTACTS = [
  { id: "friend-1", name: "Sarah", color: "#FF6B6B", weight: 5 },
  { id: "friend-2", name: "Alex K.", color: "#4ECDC4", weight: 3 },
  { id: "friend-3", name: "Jordan", color: "#45B7D1", weight: 4 },
  { id: "friend-4", name: "Sam", color: "#96CEB4", weight: 2 },
  { id: "friend-5", name: "Casey", color: "#FFD93D", weight: 3 },
  { id: "friend-6", name: "Riley M.", color: "#C9B1FF", weight: 1 },
  { id: "friend-7", name: "Morgan", color: "#98D8C8", weight: 2 },
  { id: "friend-8", name: "Taylor", color: "#F4A261", weight: 4 },
  { id: "friend-9", name: "Jamie", color: "#FF9FF3", weight: 1 },
  { id: "friend-10", name: "Drew", color: "#54A0FF", weight: 1 },
];

const WEIGHTED_FRIENDS = FRIEND_CONTACTS.flatMap((c) =>
  Array(c.weight).fill(c)
);

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

interface Message {
  id: string;
  text: string;
  timestamp: number;
  fromContact: boolean;
  reaction?: string;
  sourceDid?: string;
  sourceRkey?: string;
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
  messages: Message[];
  unreadCount: number;
  isTyping: boolean;
  lastActivity: number;
}

interface PendingDelivery {
  mode: MessagesMode;
  conversationId: string;
  text: string;
  timestamp: number;
  did: string;
  rkey: string;
  // For groups
  authorDid?: string;
}

// ---- Firehose filtering ---------------------------------------------------

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

function usableNonReplyPost(data: any): {
  text: string;
  did: string;
  rkey: string;
} | null {
  const record = data.commit?.record;
  if (!record?.text) return null;
  if (record.embed) return null;
  if (record.reply) return null;

  if (Array.isArray(record.langs) && record.langs.length > 0) {
    if (!record.langs.some((l: string) => l.toLowerCase().startsWith("en"))) {
      return null;
    }
  }
  const text = baseTextFilter(record.text, !!record.langs);
  if (!text) return null;

  const did = data.did as string | undefined;
  const rkey = data.commit?.rkey as string | undefined;
  if (!did || !rkey) return null;
  return { text, did, rkey };
}

function usableAnyPost(data: any): {
  text: string;
  did: string;
  rkey: string;
  replyRootUri?: string;
} | null {
  const record = data.commit?.record;
  if (!record?.text) return null;
  if (record.embed) return null;

  if (Array.isArray(record.langs) && record.langs.length > 0) {
    if (!record.langs.some((l: string) => l.toLowerCase().startsWith("en"))) {
      return null;
    }
  }
  const text = baseTextFilter(record.text, !!record.langs);
  if (!text) return null;

  const did = data.did as string | undefined;
  const rkey = data.commit?.rkey as string | undefined;
  if (!did || !rkey) return null;
  const replyRootUri = record.reply?.root?.uri as string | undefined;
  return { text, did, rkey, replyRootUri };
}

function postUri(did: string, rkey: string): string {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

// ---- Component ------------------------------------------------------------

const MAX_ACCOUNT_CONVOS = 40;
const MAX_GROUP_CONVOS = 30;
const MAX_MESSAGES_PER_CONVO = 120;

const BSKY_APPVIEW = "https://public.api.bsky.app";

// Session-scoped dedupe so we only backfill each thread once
const backfilledThreads = new Set<string>();

interface ThreadNode {
  $type?: string;
  post?: {
    uri: string;
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

function extractThreadPosts(node: ThreadNode | undefined): NonNullable<
  ThreadNode["post"]
>[] {
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

export function FakeMessages() {
  const [mode, setMode] = useState<MessagesMode>(loadStoredMode);
  const modeRef = useRef(mode);
  const [_profileTick, setProfileTick] = useState(0);

  // Each mode holds its own conversations + active id
  const [friendsConvos, setFriendsConvos] = useState<
    Map<string, Conversation>
  >(() => {
    const m = new Map<string, Conversation>();
    FRIEND_CONTACTS.forEach((c) => {
      m.set(c.id, {
        id: c.id,
        kind: "friends",
        displayName: c.name,
        avatarColor: c.color,
        avatarInitial: c.name[0],
        messages: [],
        unreadCount: 0,
        isTyping: false,
        lastActivity: 0,
      });
    });
    return m;
  });
  const [accountsConvos, setAccountsConvos] = useState<
    Map<string, Conversation>
  >(new Map());
  const [groupsConvos, setGroupsConvos] = useState<Map<string, Conversation>>(
    new Map()
  );

  const [friendsActiveId, setFriendsActiveId] = useState<string>(
    FRIEND_CONTACTS[0].id
  );
  const [accountsActiveId, setAccountsActiveId] = useState<string | null>(null);
  const [groupsActiveId, setGroupsActiveId] = useState<string | null>(null);

  const [inputText, setInputText] = useState("");
  const [showTapback, setShowTapback] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const pendingQueue = useRef<PendingDelivery[]>([]);
  const lastFirehoseAt = useRef(0);

  // Refs so firehose callback stays stable but reads latest mode/active id
  const activeIdsRef = useRef({
    friends: friendsActiveId,
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
    activeIdsRef.current = {
      friends: friendsActiveId,
      accounts: accountsActiveId,
      groups: groupsActiveId,
    };
  }, [friendsActiveId, accountsActiveId, groupsActiveId]);

  // Re-render when profiles resolve
  useEffect(() => {
    return profileResolver.subscribe(() => setProfileTick((t) => t + 1));
  }, []);

  // Auto-scroll on message change / mode switch
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [friendsConvos, accountsConvos, groupsConvos, mode]);

  // ---- Delivery ticker: drains pendingQueue at a mode-dependent rate ----
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (pendingQueue.current.length > 0) {
        const msg = pendingQueue.current.shift()!;
        deliverMessage(msg);
      }
      const m = modeRef.current;
      const base = m === "friends" ? 300 : 120;
      const jitter = m === "friends" ? 500 : 200;
      timeout = setTimeout(tick, base + Math.random() * jitter);
    };
    tick();
    return () => clearTimeout(timeout);
  }, []);

  function deliverMessage(p: PendingDelivery) {
    const activeId = activeIdsRef.current[p.mode];
    const setter =
      p.mode === "friends"
        ? setFriendsConvos
        : p.mode === "accounts"
          ? setAccountsConvos
          : setGroupsConvos;

    setter((prev) => {
      const next = new Map(prev);
      const conv = next.get(p.conversationId);
      if (!conv) return prev;

      let authorName: string | undefined;
      let authorColor: string | undefined;
      if (p.authorDid) {
        const prof = profileResolver.peek(p.authorDid);
        authorName =
          prof?.displayName || prof?.handle || shortDid(p.authorDid);
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
          p.conversationId !== activeId ? conv.unreadCount + 1 : conv.unreadCount,
      };
      next.set(p.conversationId, updated);
      return next;
    });
  }

  // ---- Mode-specific firehose handling ---------------------------------

  const handleFriendsFirehose = useCallback((data: any) => {
    const post = usableNonReplyPost(data);
    if (!post) return;
    const contact =
      WEIGHTED_FRIENDS[Math.floor(Math.random() * WEIGHTED_FRIENDS.length)];
    setFriendsConvos((prev) => {
      const next = new Map(prev);
      const conv = next.get(contact.id);
      if (!conv) return prev;
      next.set(contact.id, { ...conv, isTyping: true });
      return next;
    });
    pendingQueue.current.push({
      mode: "friends",
      conversationId: contact.id,
      text: post.text,
      timestamp: Date.now(),
      did: post.did,
      rkey: post.rkey,
    });
  }, []);

  const handleAccountsFirehose = useCallback((data: any) => {
    const post = usableNonReplyPost(data);
    if (!post) return;
    // Kick off profile resolution
    profileResolver.get(post.did);

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
        // LRU evict if over cap
        if (next.size >= MAX_ACCOUNT_CONVOS) {
          let oldestId: string | null = null;
          let oldestAt = Infinity;
          for (const [k, v] of next) {
            if (v.lastActivity < oldestAt) {
              oldestAt = v.lastActivity;
              oldestId = k;
            }
          }
          if (oldestId) next.delete(oldestId);
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

    pendingQueue.current.push({
      mode: "accounts",
      conversationId: post.did,
      text: post.text,
      timestamp: Date.now(),
      did: post.did,
      rkey: post.rkey,
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
          const text =
            typeof p.record?.text === "string" ? p.record.text : "";
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
          existing?.participants || []
        );
        for (const did of participants) mergedParticipants.add(did);

        const names = namesForParticipants(mergedParticipants);

        // LRU evict if over cap
        if (!existing && next.size >= MAX_GROUP_CONVOS) {
          let oldestId: string | null = null;
          let oldestAt = Infinity;
          for (const [k, v] of next) {
            if (v.lastActivity < oldestAt) {
              oldestAt = v.lastActivity;
              oldestId = k;
            }
          }
          if (oldestId) next.delete(oldestId);
        }

        next.set(rootUri, {
          id: rootUri,
          kind: "groups",
          displayName: names.display,
          subtitle: names.subtitle,
          avatarColor: colorForDid(Array.from(mergedParticipants)[0]),
          avatarInitial: names.display[0]?.toUpperCase() || "?",
          participants: mergedParticipants,
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
    // Root URI: replies use reply.root.uri; originals use their own uri
    const rootUri = post.replyRootUri || postUri(post.did, post.rkey);

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
          isTyping: true,
        });
      } else {
        // Only create a bucket if it's an original post (we may add repliers later)
        // or if it's a reply (we'll seed the thread from here)
        if (next.size >= MAX_GROUP_CONVOS) {
          let oldestId: string | null = null;
          let oldestAt = Infinity;
          for (const [k, v] of next) {
            if (v.lastActivity < oldestAt) {
              oldestAt = v.lastActivity;
              oldestId = k;
            }
          }
          if (oldestId) next.delete(oldestId);
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
      authorDid: post.did,
    });
  }, []);

  const handleFirehose = useCallback(
    (data: any) => {
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
      // Per-mode intake throttle:
      // - Friends: slow cadence preserves cozy pacing
      // - Accounts: near-unthrottled so the sidebar fills fast
      // - Groups: medium so threads have room to accumulate replies
      const minGap =
        modeRef.current === "friends"
          ? 400
          : modeRef.current === "accounts"
            ? 60
            : 150;
      if (now - lastFirehoseAt.current < minGap) return;

      switch (modeRef.current) {
        case "friends":
          handleFriendsFirehose(data);
          break;
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
      handleFriendsFirehose,
      handleAccountsFirehose,
      handleGroupsFirehose,
      backfillThread,
    ]
  );

  useJetStream({
    wantedCollections: ["app.bsky.feed.post"],
    onMessage: handleFirehose,
    onConnectionChange: () => {},
  });

  // ---- Derived current-mode state --------------------------------------

  const currentConvos =
    mode === "friends"
      ? friendsConvos
      : mode === "accounts"
        ? accountsConvos
        : groupsConvos;
  const currentActiveId =
    mode === "friends"
      ? friendsActiveId
      : mode === "accounts"
        ? accountsActiveId
        : groupsActiveId;
  const setCurrentActiveId =
    mode === "friends"
      ? setFriendsActiveId
      : mode === "accounts"
        ? (id: string | null) => setAccountsActiveId(id)
        : (id: string | null) => setGroupsActiveId(id);
  const setCurrentConvos =
    mode === "friends"
      ? setFriendsConvos
      : mode === "accounts"
        ? setAccountsConvos
        : setGroupsConvos;

  // For groups mode: only show conversations with >=2 participants
  const visibleConvos = Array.from(currentConvos.values()).filter((c) => {
    if (c.kind !== "groups") return true;
    return (c.participants?.size || 0) >= 2;
  });

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

  const handleSend = () => {
    if (!inputText.trim() || !currentActiveId) return;
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
            text: inputText.trim(),
            timestamp: Date.now(),
            fromContact: false,
          },
        ],
        lastActivity: Date.now(),
      });
      return next;
    });
    setInputText("");
  };

  const handleSelectConversation = (id: string) => {
    setCurrentActiveId(id);
    setShowTapback(null);
    setCurrentConvos((prev) => {
      const next = new Map(prev);
      const conv = next.get(id);
      if (!conv || conv.unreadCount === 0) return prev;
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
            : m
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
    mode === "friends"
      ? "iMessage"
      : mode === "accounts"
        ? "reply to this account..."
        : "send to the group...";

  return (
    <div className="fake-messages">
      <div className="messages-sidebar">
        <div className="sidebar-header">
          <Link to="/HAH" className="back-button">
            &lsaquo;
          </Link>
          <h1>Messages</h1>
          {totalUnread > 0 && (
            <span className="total-unread">{totalUnread}</span>
          )}
        </div>
        <div className="mode-switcher" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "friends"}
            className={`mode-tab ${mode === "friends" ? "active" : ""}`}
            onClick={() => handleModeChange("friends")}
            title="10 fixed fake contacts receive random Bluesky posts"
          >
            Friends
          </button>
          <button
            role="tab"
            aria-selected={mode === "accounts"}
            className={`mode-tab ${mode === "accounts" ? "active" : ""}`}
            onClick={() => handleModeChange("accounts")}
            title="Every Bluesky account becomes its own contact"
          >
            Accounts
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

        <div className="conversation-list">
          {sortedConvos.length === 0 && (
            <div className="empty-list">
              {mode === "accounts"
                ? "Waiting for accounts to post..."
                : "Waiting for conversations to form..."}
            </div>
          )}
          {sortedConvos.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${conv.id === currentActiveId ? "active" : ""}`}
              onClick={() => handleSelectConversation(conv.id)}
            >
              <ConversationAvatar conv={conv} />
              <div className="conversation-preview">
                <div className="conversation-top">
                  <span className="contact-name">{conv.displayName}</span>
                  {conv.messages.length > 0 && (
                    <span className="message-time">
                      {dayjs(
                        conv.messages[conv.messages.length - 1].timestamp
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
      </div>

      <div className="messages-main">
        {activeConversation ? (
          <>
            <div className="chat-header">
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
                const showAuthorLabel =
                  activeConversation.kind === "groups" &&
                  msg.fromContact &&
                  msg.authorName &&
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
                    >
                      <div
                        className={`message-bubble ${msg.fromContact ? "incoming" : "outgoing"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowTapback(
                            showTapback === msg.id ? null : msg.id
                          );
                        }}
                      >
                        {msg.text}
                        {msg.reaction && (
                          <span className="message-reaction">
                            {msg.reaction}
                          </span>
                        )}
                      </div>
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

            <div className="message-input-area">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={placeholder}
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
                ? "No account has posted yet. The firehose will fill this up shortly."
                : "No conversation has formed yet. Group chats appear once a thread has at least two participants."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Small helpers --------------------------------------------------------

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
  const display = resolved.slice(0, 2).join(", ") +
    (resolved.length > 2 ? ` + ${resolved.length - 2}` : "");
  const subtitle =
    resolved.length >= 2
      ? `${resolved.length} people`
      : "1 person";
  return { display, subtitle };
}

function renderPreview(conv: Conversation) {
  const last = conv.messages[conv.messages.length - 1];
  if (!last) return null;
  const prefix =
    conv.kind === "groups" && last.fromContact && last.authorName
      ? <span className="you-prefix" style={{ color: last.authorColor }}>{last.authorName}: </span>
      : !last.fromContact
        ? <span className="you-prefix">You: </span>
        : null;
  const snippet = last.text.slice(0, 35) + (last.text.length > 35 ? "\u2026" : "");
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
  if (conv.kind === "groups" && conv.participants && conv.participants.size > 1) {
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
                backgroundImage: prof?.avatar ? `url(${prof.avatar})` : undefined,
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
