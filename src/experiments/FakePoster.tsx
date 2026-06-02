import { useState, useCallback, useRef, useEffect } from "react";
import { useJetStream } from "../hooks/useJetStream";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useLocalLLM } from "./useLocalLLM";
import {
  generateHaikuComments,
  HAIKU_WORKER_URL,
  HaikuError,
  loadStoredApiKey,
  storeApiKey,
} from "./haikuComments";
import { extractSubject, scoreRelevance, type Subject } from "./topicMatch";
import { resolveCommentAuthor } from "./userIdentity";
import { profileResolver } from "./profileResolver";
import {
  ReplyIcon,
  RetweetIcon,
  HeartIcon,
  ChartIcon,
  BookmarkIcon,
  HomeIcon,
  BellIcon,
  UserIcon,
  UserPlusIcon,
  CloseIcon,
  BackIcon,
} from "./icons";
import "./FakePoster.scss";

dayjs.extend(relativeTime);

type CommentMode = "firehose" | "relevant" | "haiku" | "local";

interface PendingComment {
  text: string;
  source: CommentMode;
  did?: string;
  rkey?: string;
  // Identity baked in by the generator (local LLM); absent for real posts,
  // which resolve their author from did at render time.
  name?: string;
  handle?: string;
}

const MODE_STORAGE_KEY = "hah.poster.mode";

function loadStoredMode(): CommentMode {
  if (typeof localStorage === "undefined") return "firehose";
  const raw = localStorage.getItem(MODE_STORAGE_KEY);
  // Haiku is only available when its worker URL is configured (i.e. not in
  // public builds that omit it); fall back so the stored mode isn't orphaned.
  if (raw === "haiku") {
    return import.meta.env.VITE_HAIKU_WORKER_URL ? "haiku" : "firehose";
  }
  if (raw === "local" || raw === "firehose" || raw === "relevant") return raw;
  return "firehose";
}

const FAKE_USERS = [
  { name: "Maya Chen", handle: "mayac" },
  { name: "Jake Rivers", handle: "devjake_" },
  { name: "Sofia Ramirez", handle: "sofiaaa" },
  { name: "Aiden Park", handle: "aidenp" },
  { name: "Lila Montgomery", handle: "lilamontg" },
  { name: "Marcus Webb", handle: "mwebb_" },
  { name: "Zoe Nakamura", handle: "znakamura" },
  { name: "Ethan Okonkwo", handle: "ethan_ok" },
  { name: "Priya Sharma", handle: "priyaas" },
  { name: "Noah Fischer", handle: "noahf" },
  { name: "Iris Kim", handle: "irisk" },
  { name: "Leo Andersen", handle: "leoa_" },
  { name: "Chloe Baptiste", handle: "chloebap" },
  { name: "Kai Tanaka", handle: "kait" },
  { name: "Ella Washington", handle: "ellaw" },
];

function randomUser() {
  return FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)];
}

function formatCount(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

interface TweetComment {
  id: string;
  text: string;
  timestamp: number;
  likes: number;
  sourceDid?: string;
  sourceRkey?: string;
  // Generator-supplied identity (local LLM); absent comments resolve from
  // sourceDid (real posts) or fall back to a procedural identity.
  authorName?: string;
  authorHandle?: string;
}

interface Tweet {
  id: string;
  text: string;
  timestamp: number;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  comments: TweetComment[];
  bookmarks: number;
  // LLM-generated comments for this specific tweet (so they don't mix with other tweets' queues)
  privatePool: PendingComment[];
}

interface Notification {
  id: string;
  type: "like" | "retweet" | "reply" | "follow";
  user: (typeof FAKE_USERS)[0];
  text?: string;
  timestamp: number;
}

interface SourcePost {
  text: string;
  did: string;
  rkey: string;
}

function isUsablePost(data: any): SourcePost | null {
  const record = data.commit?.record;
  if (!record?.text) return null;
  if (record.embed) return null;

  if (Array.isArray(record.langs) && record.langs.length > 0) {
    if (!record.langs.some((l: string) => l.toLowerCase().startsWith("en"))) {
      return null;
    }
  }

  let text = record.text as string;
  text = text.replace(/#\w+/g, "").replace(/\s+/g, " ").trim();

  if (text.length > 200 || text.length < 5) return null;
  if (text.startsWith("@") || text.startsWith("RT ")) return null;
  if (text.includes("http://") || text.includes("https://")) return null;

  if (!record.langs) {
    const asciiCount = text
      .split("")
      .filter((c) => c.charCodeAt(0) < 128).length;
    if (asciiCount / text.length < 0.7) return null;
  }

  const did = data.did as string | undefined;
  const rkey = data.commit?.rkey as string | undefined;
  if (!did || !rkey) return null;

  return { text, did, rkey };
}

function AnimatedCount({ value }: { value: number }) {
  const prev = useRef(value);
  const [floaters, setFloaters] = useState<{ id: number; delta: number }[]>([]);
  const pulseKey = useRef(0);

  useEffect(() => {
    if (value > prev.current) {
      const delta = value - prev.current;
      pulseKey.current += 1;
      // Only show +N floater for meaningful jumps
      if (delta > 0) {
        const id = Date.now() + Math.random();
        setFloaters((f) => [...f, { id, delta }]);
        setTimeout(() => {
          setFloaters((f) => f.filter((x) => x.id !== id));
        }, 900);
      }
    }
    prev.current = value;
  }, [value]);

  return (
    <span className="animated-count">
      <span key={pulseKey.current} className="count-value">
        {formatCount(value)}
      </span>
      {floaters.map((f) => (
        <span key={f.id} className="count-floater">
          +{f.delta}
        </span>
      ))}
    </span>
  );
}

export function FakePoster() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [composerText, setComposerText] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mode, setMode] = useState<CommentMode>(loadStoredMode);
  const [modeError, setModeError] = useState<string | null>(null);
  // The user's own Anthropic key (BYOK) for Haiku mode, kept in their browser.
  const [apiKey, setApiKey] = useState<string>(loadStoredApiKey);
  const [keyInput, setKeyInput] = useState("");
  const [expandedTweets, setExpandedTweets] = useState<Set<string>>(new Set());
  // Bumped when a real Bluesky profile resolves, to re-render comment authors.
  const [, setProfileTick] = useState(0);

  useEffect(
    () => profileResolver.subscribe(() => setProfileTick((t) => t + 1)),
    []
  );

  const toggleExpanded = (tweetId: string) => {
    setExpandedTweets((prev) => {
      const next = new Set(prev);
      if (next.has(tweetId)) next.delete(tweetId);
      else next.add(tweetId);
      return next;
    });
  };
  const commentQueue = useRef<PendingComment[]>([]);
  const engagementTimers = useRef<Map<string, number>>(new Map());
  const modeRef = useRef(mode);
  // Subjects extracted from currently-displayed tweets, keyed by tweet id, so
  // the firehose handler can route topically-matching posts to the right tweet.
  const tweetSubjects = useRef<Map<string, Subject>>(new Map());
  const localLLM = useLocalLLM();

  // Minimum overlap score a firehose post needs to count as on-topic.
  const RELEVANCE_THRESHOLD = 1;

  useEffect(() => {
    modeRef.current = mode;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  }, [mode]);

  // Route a topically-relevant firehose post into the best-matching live
  // tweet's private pool. Returns true when it found a home.
  const routeRelevantPost = useCallback((post: SourcePost): boolean => {
    let bestTweetId: string | null = null;
    let bestScore = 0;
    tweetSubjects.current.forEach((subject, tweetId) => {
      const score = scoreRelevance(subject, post.text);
      if (score > bestScore) {
        bestScore = score;
        bestTweetId = tweetId;
      }
    });

    if (bestTweetId === null || bestScore < RELEVANCE_THRESHOLD) return false;

    const matchId = bestTweetId;
    const pending: PendingComment = {
      text: post.text,
      source: "relevant",
      did: post.did,
      rkey: post.rkey,
    };
    setTweets((prev) =>
      prev.map((t) =>
        t.id === matchId
          ? { ...t, privatePool: [...t.privatePool, pending].slice(-40) }
          : t
      )
    );
    return true;
  }, []);

  // Buffer firehose posts. In firehose mode everything goes to the shared
  // queue; in relevant mode only topically-matching posts are kept.
  const handleFirehose = useCallback(
    (data: any) => {
      const activeMode = modeRef.current;
      if (activeMode !== "firehose" && activeMode !== "relevant") return;
      const post = isUsablePost(data);
      if (!post) return;

      if (activeMode === "relevant") {
        routeRelevantPost(post);
        return;
      }

      commentQueue.current.push({
        text: post.text,
        source: "firehose",
        did: post.did,
        rkey: post.rkey,
      });
      if (commentQueue.current.length > 100) {
        commentQueue.current = commentQueue.current.slice(-50);
      }
    },
    [routeRelevantPost]
  );

  useJetStream({
    wantedCollections: ["app.bsky.feed.post"],
    onMessage: handleFirehose,
    onConnectionChange: () => {},
  });

  // Main engagement simulation loop
  useEffect(() => {
    const interval = setInterval(() => {
      setTweets((prev) => {
        if (prev.length === 0) return prev;
        return prev.map((tweet) => {
          const elapsed = engagementTimers.current.get(tweet.id) || 0;
          engagementTimers.current.set(tweet.id, elapsed + 1);

          // Brief delay before engagement starts
          if (elapsed < 1) return tweet;

          const decay = Math.max(0.2, 1 / (1 + (elapsed - 1) * 0.006));

          const newLikes =
            Math.random() < 0.7 * decay
              ? Math.ceil(Math.random() * 5)
              : 0;
          const newRetweets = Math.random() < 0.3 * decay ? 1 : 0;
          const newViews = Math.ceil(Math.random() * 200 * decay) + 15;
          const newBookmarks = Math.random() < 0.1 * decay ? 1 : 0;

          let newComment: TweetComment | null = null;
          let newPrivatePool = tweet.privatePool;
          if (Math.random() < 0.25 * decay) {
            // Prefer this tweet's own LLM-generated pool, fall back to shared firehose queue
            let pending: PendingComment | undefined;
            if (tweet.privatePool.length > 0) {
              pending = tweet.privatePool[0];
              newPrivatePool = tweet.privatePool.slice(1);
            } else if (commentQueue.current.length > 0) {
              pending = commentQueue.current.shift();
            }
            if (pending) {
              newComment = {
                id: `comment-${Date.now()}-${Math.random()}`,
                text: pending.text,
                timestamp: Date.now(),
                likes: Math.floor(Math.random() * 10),
                sourceDid: pending.did,
                sourceRkey: pending.rkey,
                authorName: pending.name,
                authorHandle: pending.handle,
              };
            }
          }

          // Generate notifications for some engagement events
          if (newLikes > 0 && Math.random() < 0.3) {
            const user = randomUser();
            setNotifications((n) =>
              [
                {
                  id: `notif-${Date.now()}-${Math.random()}`,
                  type: "like" as const,
                  user,
                  timestamp: Date.now(),
                },
                ...n,
              ].slice(0, 200)
            );
            setUnreadCount((c) => c + 1);
          }
          if (newRetweets > 0) {
            const user = randomUser();
            setNotifications((n) =>
              [
                {
                  id: `notif-${Date.now()}-${Math.random()}`,
                  type: "retweet" as const,
                  user,
                  timestamp: Date.now(),
                },
                ...n,
              ].slice(0, 200)
            );
            setUnreadCount((c) => c + 1);
          }
          if (newComment) {
            const author = resolveCommentAuthor({
              sourceDid: newComment.sourceDid,
              name: newComment.authorName,
              handle: newComment.authorHandle,
              seed: newComment.id,
            });
            setNotifications((n) =>
              [
                {
                  id: `notif-${Date.now()}-${Math.random()}`,
                  type: "reply" as const,
                  user: { name: author.name, handle: author.handle },
                  text: newComment!.text,
                  timestamp: Date.now(),
                },
                ...n,
              ].slice(0, 200)
            );
            setUnreadCount((c) => c + 1);
          }
          if (Math.random() < 0.02 * decay) {
            const user = randomUser();
            setNotifications((n) =>
              [
                {
                  id: `notif-${Date.now()}-${Math.random()}`,
                  type: "follow" as const,
                  user,
                  timestamp: Date.now(),
                },
                ...n,
              ].slice(0, 200)
            );
            setUnreadCount((c) => c + 1);
          }

          return {
            ...tweet,
            likes: tweet.likes + newLikes,
            retweets: tweet.retweets + newRetweets,
            views: tweet.views + newViews,
            bookmarks: tweet.bookmarks + newBookmarks,
            replies: tweet.replies + (newComment ? 1 : 0),
            comments: newComment
              ? [...tweet.comments, newComment]
              : tweet.comments,
            privatePool: newPrivatePool,
          };
        });
      });
    }, 220);

    return () => clearInterval(interval);
  }, []);

  const handlePost = async () => {
    if (!composerText.trim()) return;
    const postText = composerText.trim();
    const tweetId = `tweet-${Date.now()}`;
    const newTweet: Tweet = {
      id: tweetId,
      text: postText,
      timestamp: Date.now(),
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      comments: [],
      bookmarks: 0,
      privatePool: [],
    };
    setTweets((prev) => [newTweet, ...prev]);
    engagementTimers.current.set(newTweet.id, 0);
    setComposerText("");
    setModeError(null);

    const activeMode = modeRef.current;
    if (activeMode === "relevant") {
      const subject = extractSubject(postText);
      tweetSubjects.current.set(tweetId, subject);
      // Only the most recent posts actively pull in matching firehose posts.
      if (tweetSubjects.current.size > 8) {
        const oldest = tweetSubjects.current.keys().next().value;
        if (oldest) tweetSubjects.current.delete(oldest);
      }
      if (subject.keywords.length === 0) {
        setModeError(
          "No clear subject found — try a post with a concrete noun."
        );
      }
    }
    if (activeMode === "haiku") {
      let comments;
      try {
        comments = await generateHaikuComments(postText, 25, apiKey);
      } catch (e) {
        setModeError(
          e instanceof HaikuError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Haiku request failed"
        );
        return;
      }
      if (comments.length === 0) {
        setModeError("Haiku returned no comments — try again");
        return;
      }
      const pending = comments.map((c) => ({
        text: c.text,
        source: "haiku" as const,
        name: c.name,
        handle: c.handle,
      }));
      setTweets((prev) =>
        prev.map((t) =>
          t.id === tweetId
            ? { ...t, privatePool: [...t.privatePool, ...pending] }
            : t
        )
      );
    } else if (activeMode === "local") {
      if (localLLM.status !== "ready") return;
      const comments = await localLLM.generate(postText, 20);
      const pending = comments.map((c) => ({
        text: c.text,
        source: "local" as const,
        name: c.name,
        handle: c.handle,
      }));
      setTweets((prev) =>
        prev.map((t) =>
          t.id === tweetId
            ? { ...t, privatePool: [...t.privatePool, ...pending] }
            : t
        )
      );
    }
  };

  const handleModeChange = (next: CommentMode) => {
    setMode(next);
    commentQueue.current = [];
    setModeError(null);
    if (next === "local" && localLLM.status === "idle") {
      void localLLM.load();
    }
  };

  const handleOpenNotifications = () => {
    setShowNotifications(!showNotifications);
    if (!showNotifications) {
      setUnreadCount(0);
    }
  };

  const notificationIcon = (type: string) => {
    switch (type) {
      case "like":
        return <HeartIcon size={18} className="notif-icon-svg like" />;
      case "retweet":
        return <RetweetIcon size={18} className="notif-icon-svg retweet" />;
      case "reply":
        return <ReplyIcon size={18} className="notif-icon-svg reply" />;
      case "follow":
        return <UserPlusIcon size={18} className="notif-icon-svg follow" />;
      default:
        return <BellIcon size={18} className="notif-icon-svg" />;
    }
  };

  return (
    <div className="fake-poster">
      <nav className="poster-sidebar">
        <Link to="/" className="nav-item back" aria-label="Back to index">
          <BackIcon />
        </Link>
        <div className="nav-logo">{"𝕏"}</div>
        <div className="nav-item active" aria-label="Home">
          <HomeIcon />
        </div>
        <div
          className="nav-item notification-nav"
          onClick={handleOpenNotifications}
          aria-label="Notifications"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="nav-badge">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        <div className="nav-item" aria-label="Profile">
          <UserIcon />
        </div>
      </nav>

      <main className="poster-main">
        <div className="poster-header">
          <h2>Home</h2>
          <div className="mode-switcher" role="tablist" aria-label="Comment source">
            <button
              role="tab"
              aria-selected={mode === "firehose"}
              className={`mode-tab ${mode === "firehose" ? "active" : ""}`}
              onClick={() => handleModeChange("firehose")}
              title="Comments sourced from the live Bluesky firehose"
            >
              Firehose
            </button>
            <button
              role="tab"
              aria-selected={mode === "relevant"}
              className={`mode-tab ${mode === "relevant" ? "active" : ""}`}
              onClick={() => handleModeChange("relevant")}
              title="Firehose posts that loosely match your post's subject"
            >
              Relevant
            </button>
            {HAIKU_WORKER_URL && (
              <button
                role="tab"
                aria-selected={mode === "haiku"}
                className={`mode-tab ${mode === "haiku" ? "active" : ""}`}
                onClick={() => handleModeChange("haiku")}
                title="Comments generated by Claude Haiku"
              >
                Haiku
              </button>
            )}
            <button
              role="tab"
              aria-selected={mode === "local"}
              className={`mode-tab ${mode === "local" ? "active" : ""}`}
              onClick={() => handleModeChange("local")}
              disabled={localLLM.status === "unsupported"}
              title={
                localLLM.status === "unsupported"
                  ? "WebGPU unavailable in this browser"
                  : "Comments generated by a local in-browser model"
              }
            >
              Local
            </button>
          </div>
        </div>

        {mode === "local" && localLLM.status === "loading" && (
          <div className="mode-status loading">
            Loading local model…{" "}
            {Math.round(localLLM.progress * 100)}%
            <div className="mode-progress">
              <div
                className="mode-progress-bar"
                style={{ width: `${localLLM.progress * 100}%` }}
              />
            </div>
            <div className="mode-status-detail">{localLLM.progressText}</div>
          </div>
        )}
        {mode === "local" && localLLM.status === "idle" && (
          <div className="mode-status">
            Click "Local" again to start downloading the model (~800MB, cached
            after).
          </div>
        )}
        {mode === "local" && localLLM.status === "error" && (
          <div className="mode-status error">
            Local model failed to load: {localLLM.error}
          </div>
        )}
        {mode === "local" && localLLM.status === "unsupported" && (
          <div className="mode-status error">
            This browser doesn't support WebGPU. Try Chrome or Edge.
          </div>
        )}
        {mode === "haiku" && !apiKey && (
          <form
            className="apikey-panel"
            onSubmit={(e) => {
              e.preventDefault();
              const k = keyInput.trim();
              if (!k) return;
              setApiKey(k);
              storeApiKey(k);
              setKeyInput("");
              setModeError(null);
            }}
          >
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-… your Anthropic API key"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit">Save</button>
            <p className="apikey-note">
              Bring your own key. It's stored only in this browser and sent
              per-request to generate comments — never saved on a server.{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a key ↗
              </a>
            </p>
          </form>
        )}
        {mode === "haiku" && apiKey && (
          <div className="mode-status">
            Using your Anthropic key (stored in this browser).{" "}
            <button
              className="apikey-clear"
              onClick={() => {
                setApiKey("");
                storeApiKey("");
              }}
            >
              remove key
            </button>
          </div>
        )}
        {(mode === "haiku" || mode === "relevant") && modeError && (
          <div className="mode-status error">{modeError}</div>
        )}
        {mode === "relevant" && (
          <div className="mode-status">
            Comments are live firehose posts that loosely match your post's
            subject. Posts with a concrete subject ("ice cream", "the election")
            match best.
          </div>
        )}

        <div className="poster-scroll">
          <div className="composer">
            <div className="composer-avatar">Y</div>
            <div className="composer-input-area">
              <textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder="What is happening?!"
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handlePost();
                  }
                }}
              />
              <div className="composer-actions">
                <span className="char-count">
                  {composerText.length > 0 ? `${composerText.length}/280` : ""}
                </span>
                <button
                  className="post-button"
                  onClick={handlePost}
                  disabled={!composerText.trim()}
                >
                  Post
                </button>
              </div>
            </div>
          </div>

          <div className="feed">
            {tweets.length === 0 && (
              <div className="empty-feed">
                <p>Your posts will appear here.</p>
                <p className="empty-sub">Write something. See what happens.</p>
              </div>
            )}
            {tweets.map((tweet) => (
              <div key={tweet.id} className="tweet">
                <div className="tweet-avatar">Y</div>
                <div className="tweet-content">
                  <div className="tweet-header">
                    <span className="tweet-name">You</span>
                    <span className="tweet-handle">@you</span>
                    <span className="tweet-dot">&middot;</span>
                    <span className="tweet-time">
                      {dayjs(tweet.timestamp).fromNow()}
                    </span>
                  </div>
                  <p className="tweet-text">{tweet.text}</p>
                  <div className="tweet-actions">
                    <span className="action replies">
                      <ReplyIcon size={16} />
                      <AnimatedCount value={tweet.replies} />
                    </span>
                    <span className="action retweets">
                      <RetweetIcon size={16} />
                      <AnimatedCount value={tweet.retweets} />
                    </span>
                    <span className="action likes">
                      <HeartIcon size={16} />
                      <AnimatedCount value={tweet.likes} />
                    </span>
                    <span className="action views">
                      <ChartIcon size={16} />
                      <AnimatedCount value={tweet.views} />
                    </span>
                    <span className="action bookmarks">
                      <BookmarkIcon size={16} />
                      {tweet.bookmarks > 0 && (
                        <AnimatedCount value={tweet.bookmarks} />
                      )}
                    </span>
                  </div>

                  {tweet.comments.length > 0 && (
                    <div className="tweet-comments">
                      {(expandedTweets.has(tweet.id)
                        ? tweet.comments
                        : tweet.comments.slice(-5)
                      ).map((comment) => {
                        const author = resolveCommentAuthor({
                          sourceDid: comment.sourceDid,
                          name: comment.authorName,
                          handle: comment.authorHandle,
                          seed: comment.id,
                        });
                        return (
                        <div key={comment.id} className="comment">
                          <div
                            className="comment-avatar"
                            style={
                              author.avatar
                                ? undefined
                                : {
                                    backgroundColor: `hsl(${author.handle.length * 40}, 55%, 45%)`,
                                  }
                            }
                          >
                            {author.avatar ? (
                              <img
                                src={author.avatar}
                                alt=""
                                className="comment-avatar-img"
                              />
                            ) : (
                              author.name[0]
                            )}
                          </div>
                          <div className="comment-content">
                            <span className="comment-name">
                              {author.name}
                            </span>
                            <span className="comment-handle">
                              @{author.handle}
                            </span>
                            {comment.sourceDid && comment.sourceRkey && (
                              <a
                                className="comment-source"
                                href={`https://bsky.app/profile/${comment.sourceDid}/post/${comment.sourceRkey}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View original post on Bluesky"
                              >
                                ↗
                              </a>
                            )}
                            <p className="comment-text">{comment.text}</p>
                          </div>
                        </div>
                        );
                      })}
                      {tweet.comments.length > 5 && (
                        <button
                          className="more-comments"
                          onClick={() => toggleExpanded(tweet.id)}
                        >
                          {expandedTweets.has(tweet.id)
                            ? "Show less"
                            : `Show ${tweet.comments.length - 5} more replies`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <div
        className={`notification-panel ${showNotifications ? "open" : ""}`}
      >
        <div className="notif-header">
          <h3>Notifications</h3>
          <button
            className="notif-close"
            onClick={() => setShowNotifications(false)}
            aria-label="Close notifications"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="notif-list">
          {notifications.length === 0 ? (
            <div className="notif-empty">Nothing yet. Post something!</div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                className={`notif-item notif-${notif.type}`}
              >
                <span className="notif-icon">
                  {notificationIcon(notif.type)}
                </span>
                <div className="notif-content">
                  <span className="notif-user">{notif.user.name}</span>
                  {notif.type === "like" && " liked your post"}
                  {notif.type === "retweet" && " reposted your post"}
                  {notif.type === "reply" && (
                    <>
                      {" "}
                      replied:{" "}
                      <span className="notif-text">
                        &ldquo;{notif.text?.slice(0, 60)}
                        {(notif.text?.length || 0) > 60 ? "\u2026" : ""}
                        &rdquo;
                      </span>
                    </>
                  )}
                  {notif.type === "follow" && " followed you"}
                  <div className="notif-time">
                    {dayjs(notif.timestamp).fromNow()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showNotifications && (
        <div
          className="notification-overlay"
          onClick={() => setShowNotifications(false)}
        />
      )}
    </div>
  );
}
