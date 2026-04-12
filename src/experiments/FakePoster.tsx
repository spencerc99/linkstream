import { useState, useCallback, useRef, useEffect } from "react";
import { useJetStream } from "../hooks/useJetStream";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useLocalLLM } from "./useLocalLLM";
import {
  generateHaikuComments,
  HAIKU_WORKER_URL,
} from "./haikuComments";
import "./FakePoster.scss";

dayjs.extend(relativeTime);

type CommentMode = "firehose" | "haiku" | "local";

interface PendingComment {
  text: string;
  source: CommentMode;
  did?: string;
  rkey?: string;
}

const MODE_STORAGE_KEY = "hah.poster.mode";

function loadStoredMode(): CommentMode {
  if (typeof localStorage === "undefined") return "firehose";
  const raw = localStorage.getItem(MODE_STORAGE_KEY);
  if (raw === "haiku" || raw === "local" || raw === "firehose") return raw;
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
  user: (typeof FAKE_USERS)[0];
  text: string;
  timestamp: number;
  likes: number;
  sourceDid?: string;
  sourceRkey?: string;
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

export function FakePoster() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [composerText, setComposerText] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mode, setMode] = useState<CommentMode>(loadStoredMode);
  const [haikuError, setHaikuError] = useState<string | null>(null);
  const commentQueue = useRef<PendingComment[]>([]);
  const engagementTimers = useRef<Map<string, number>>(new Map());
  const modeRef = useRef(mode);
  const localLLM = useLocalLLM();

  useEffect(() => {
    modeRef.current = mode;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
  }, [mode]);

  // Buffer firehose posts (only when firehose mode is active)
  const handleFirehose = useCallback((data: any) => {
    if (modeRef.current !== "firehose") return;
    const post = isUsablePost(data);
    if (post) {
      commentQueue.current.push({
        text: post.text,
        source: "firehose",
        did: post.did,
        rkey: post.rkey,
      });
      if (commentQueue.current.length > 100) {
        commentQueue.current = commentQueue.current.slice(-50);
      }
    }
  }, []);

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
          if (
            commentQueue.current.length > 0 &&
            Math.random() < 0.25 * decay
          ) {
            const pending = commentQueue.current.shift()!;
            newComment = {
              id: `comment-${Date.now()}-${Math.random()}`,
              user: randomUser(),
              text: pending.text,
              timestamp: Date.now(),
              likes: Math.floor(Math.random() * 10),
              sourceDid: pending.did,
              sourceRkey: pending.rkey,
            };
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
            setNotifications((n) =>
              [
                {
                  id: `notif-${Date.now()}-${Math.random()}`,
                  type: "reply" as const,
                  user: newComment!.user,
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
          };
        });
      });
    }, 220);

    return () => clearInterval(interval);
  }, []);

  const handlePost = async () => {
    if (!composerText.trim()) return;
    const postText = composerText.trim();
    const newTweet: Tweet = {
      id: `tweet-${Date.now()}`,
      text: postText,
      timestamp: Date.now(),
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      comments: [],
      bookmarks: 0,
    };
    setTweets((prev) => [newTweet, ...prev]);
    engagementTimers.current.set(newTweet.id, 0);
    setComposerText("");
    setHaikuError(null);

    const activeMode = modeRef.current;
    if (activeMode === "haiku") {
      const comments = await generateHaikuComments(postText, 25);
      if (comments.length === 0) {
        setHaikuError(
          HAIKU_WORKER_URL
            ? "Haiku returned no comments (check Worker logs)"
            : "VITE_HAIKU_WORKER_URL is not set"
        );
        return;
      }
      commentQueue.current.push(
        ...comments.map((text) => ({ text, source: "haiku" as const }))
      );
    } else if (activeMode === "local") {
      if (localLLM.status !== "ready") return;
      const comments = await localLLM.generate(postText, 20);
      commentQueue.current.push(
        ...comments.map((text) => ({ text, source: "local" as const }))
      );
    }
  };

  const handleModeChange = (next: CommentMode) => {
    setMode(next);
    commentQueue.current = [];
    setHaikuError(null);
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
        return "\u2764\uFE0F";
      case "retweet":
        return "\uD83D\uDD04";
      case "reply":
        return "\uD83D\uDCAC";
      case "follow":
        return "\uD83D\uDC64";
      default:
        return "\uD83D\uDD14";
    }
  };

  return (
    <div className="fake-poster">
      <nav className="poster-sidebar">
        <Link to="/HAH" className="nav-item back">
          &larr;
        </Link>
        <div className="nav-logo">{"𝕏"}</div>
        <div className="nav-item active">
          <span className="nav-icon">{"🏠"}</span>
        </div>
        <div
          className="nav-item notification-nav"
          onClick={handleOpenNotifications}
        >
          <span className="nav-icon">{"🔔"}</span>
          {unreadCount > 0 && (
            <span className="nav-badge">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        <div className="nav-item">
          <span className="nav-icon">{"👤"}</span>
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
              aria-selected={mode === "haiku"}
              className={`mode-tab ${mode === "haiku" ? "active" : ""}`}
              onClick={() => handleModeChange("haiku")}
              disabled={!HAIKU_WORKER_URL}
              title={
                HAIKU_WORKER_URL
                  ? "Comments generated by Claude Haiku"
                  : "Set VITE_HAIKU_WORKER_URL to enable"
              }
            >
              Haiku
            </button>
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
        {mode === "haiku" && !HAIKU_WORKER_URL && (
          <div className="mode-status error">
            Set <code>VITE_HAIKU_WORKER_URL</code> in <code>.env.local</code>{" "}
            after deploying the worker.
          </div>
        )}
        {mode === "haiku" && haikuError && (
          <div className="mode-status error">{haikuError}</div>
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
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                    handlePost();
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
                      {"💬"} {formatCount(tweet.replies)}
                    </span>
                    <span className="action retweets">
                      {"🔁"} {formatCount(tweet.retweets)}
                    </span>
                    <span className="action likes">
                      {"❤️"} {formatCount(tweet.likes)}
                    </span>
                    <span className="action views">
                      {"📊"} {formatCount(tweet.views)}
                    </span>
                  </div>

                  {tweet.comments.length > 0 && (
                    <div className="tweet-comments">
                      {tweet.comments.slice(-5).map((comment) => (
                        <div key={comment.id} className="comment">
                          <div
                            className="comment-avatar"
                            style={{
                              backgroundColor: `hsl(${comment.user.handle.length * 40}, 55%, 45%)`,
                            }}
                          >
                            {comment.user.name[0]}
                          </div>
                          <div className="comment-content">
                            <span className="comment-name">
                              {comment.user.name}
                            </span>
                            <span className="comment-handle">
                              @{comment.user.handle}
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
                      ))}
                      {tweet.comments.length > 5 && (
                        <div className="more-comments">
                          Show {tweet.comments.length - 5} more replies
                        </div>
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
          >
            {"✕"}
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
