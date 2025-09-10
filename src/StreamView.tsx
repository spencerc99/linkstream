import { useCallback, useState, useMemo, useRef, useEffect } from "react";
import { LinkPost, ExternalEmbed, RemoteControlState } from "./types";
import { useJetStream } from "./hooks/useJetStream";
import { DomainHistogram } from "./components/DomainHistogram";
import { LinkPreview } from "./components/LinkPreview";
import { RemoteControl } from "./components/RemoteControl";
import { MeteorShower } from "./components/MeteorShower";
import { FocusMode } from "./components/FocusMode";
import { shouldShowLink } from "./utils/contentClassification";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const DEFAULT_HISTORY_SIZE = 18;

// Add new type for domain counts
type DomainCounts = Record<string, number>;

/**
 * This is pretty interesting so far..
 * group by domain and show everything? with a big thing for the latest from each domain?
 * single url view at a time and automatic buffer before moving to next one?
 * keep a global map of what domains dont work with iframe and skip them? or just add them to a global "don't embed" group?
 */

// Add this URL transformer mapping
const URL_TRANSFORMERS: Record<string, (url: string) => string> = {
  "youtube.com": (url: string) => {
    const videoId = url.match(/(?:v=|youtu\.be\/)([^&?]+)/)?.[1];
    return videoId
      ? `https://www.youtube.com/embed/${videoId}?autoplay=1`
      : url;
  },
  "youtu.be": (url: string) => URL_TRANSFORMERS["youtube.com"](url),
  "x.com": (url: string) => {
    // Extract tweet ID from URLs like x.com/username/status/123456
    const tweetId = url.match(/status\/(\d+)/)?.[1];
    return tweetId
      ? `https://platform.twitter.com/embed/Tweet.html?frame=false&hideCard=false&hideThread=false&id=${tweetId}&theme=light&width=550px`
      : url;
  },
  "twitter.com": (url: string) => URL_TRANSFORMERS["x.com"](url), // Use same transformer for twitter.com
  "open.spotify.com": (url: string) => {
    // Convert URLs like:
    // https://open.spotify.com/track/123 -> https://open.spotify.com/embed/track/123
    // https://open.spotify.com/album/123 -> https://open.spotify.com/embed/album/123
    // https://open.spotify.com/playlist/123 -> https://open.spotify.com/embed/playlist/123
    const path = new URL(url).pathname;
    return `https://open.spotify.com/embed${path}`;
  },
  "tiktok.com": (url: string) => {
    const videoId = url.match(/video\/(\d+)/)?.[1];
    return videoId ? `https://www.tiktok.com/embed/v/${videoId}` : url;
  },
  "instagram.com": (url: string) => {
    const postId = url.match(/p\/(\d+)/)?.[1];
    return postId ? `https://www.instagram.com/p/${postId}/embed` : url;
  },
  "facebook.com": (url: string) => {
    const postId = url.match(/p\/(\d+)/)?.[1];
    return postId
      ? `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(
          url
        )}`
      : url;
  },
  "linkedin.com": (url: string) => {
    const postId = url.match(/p\/(\d+)/)?.[1];
    return postId
      ? `https://www.linkedin.com/embed/feed/update/urn:li:share:${postId}`
      : url;
  },
  "reddit.com": (url: string) => {
    const postId = url.match(/r\/(\w+)\/comments\/(\w+)/)?.[2];
    return postId ? `https://www.reddit.com/embed/comments/${postId}` : url;
  },
  "github.com": (url: string) => {
    const repo = url.match(/github\.com\/([^/]+)\/([^/]+)/)?.[2];
    return repo ? `https://github.com/${repo}/embed` : url;
  },
  "gitlab.com": (url: string) => {
    const repo = url.match(/gitlab\.com\/([^/]+)\/([^/]+)/)?.[2];
    return repo ? `https://gitlab.com/${repo}/embed` : url;
  },
  "stackoverflow.com": (url: string) => {
    const questionId = url.match(/questions\/(\d+)/)?.[1];
    return questionId
      ? `https://stackoverflow.com/questions/${questionId}/embed`
      : url;
  },
  // "medium.com": (url: string) => {
  //   const postId = url.match(/@([^/]+)\/([^/]+)/)?.[2];
  //   return postId ? `https://medium.com/embed/${postId}` : url;
  // },
  // "substack.com": (url: string) => {
  //   const postId = url.match(/@([^/]+)\/([^/]+)/)?.[2];
  //   return postId ? `https://substack.com/embed/${postId}` : url;
  // },
  "dev.to": (url: string) => {
    const postId = url.match(/dev\.to\/([^/]+)\/([^/]+)/)?.[2];
    return postId ? `https://dev.to/embed/${postId}` : url;
  },
  "threads.net": (url: string) => {
    const postId = url.match(/threads\.net\/([^/]+)\/([^/]+)/)?.[2];
    return postId ? `https://threads.net/embed/${postId}` : url;
  },
};

// Helper function to normalize hostnames (remove www. prefix)
// This ensures that domains like "www.example.com" and "example.com" are treated as the same domain
// for counting and grouping purposes
function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

// Helper function to transform URLs
function transformUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const normalizedDomain = normalizeHostname(hostname);

    // Try to find transformer by normalized domain first, then by original hostname
    const transformer =
      URL_TRANSFORMERS[normalizedDomain] || URL_TRANSFORMERS[hostname];
    return transformer ? transformer(url) : url;
  } catch {
    return url;
  }
}

export function StreamView() {
  const [links, setLinks] = useState<LinkPost[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [domainCounts, setDomainCounts] = useState<DomainCounts>({});
  const [remoteState, setRemoteState] = useState<RemoteControlState>({
    visualMode: "grid",
    contentFilter: "all",
    isPaused: false,
    speed: 1,
  });

  // Queue for throttling incoming messages
  const messageQueueRef = useRef<any[]>([]);
  const processingTimeoutRef = useRef<NodeJS.Timeout>();

  const addNewLink = useCallback((external: ExternalEmbed, message: any) => {
    setLinks((prevLinks) => {
      const newLink: LinkPost = {
        url: external.uri,
        timestamp: message.time_us,
        postAuthor: message.did,
        postId: message.commit.rkey,
        postText: message.commit.record.text,
        title: external.title,
        description: external.description,
        // Thumb isnt useful unless we do an extra call https://github.com/bluesky-social/atproto/discussions/1311#discussioncomment-6420935
      };

      // Update domain counts with normalized hostname
      const hostname = new URL(external.uri).hostname;
      const normalizedDomain = normalizeHostname(hostname);
      setDomainCounts((prev) => ({
        ...prev,
        [normalizedDomain]: (prev[normalizedDomain] || 0) + 1,
      }));

      return [newLink, ...prevLinks].slice(0, DEFAULT_HISTORY_SIZE);
    });
  }, []);

  // Process queued messages with throttling
  const processMessageQueue = useCallback(() => {
    if (messageQueueRef.current.length > 0 && !remoteState.isPaused) {
      const message = messageQueueRef.current.shift();

      if (message?.commit?.record?.embed?.external) {
        // skip if it is a bsky link
        if (
          message.commit.record.embed.external.uri.startsWith(
            "https://bsky.social"
          )
        ) {
          // Still schedule next processing even if we skip this message
          const delay = remoteState.speed < 1 ? 1000 / remoteState.speed : 0;
          processingTimeoutRef.current = setTimeout(processMessageQueue, delay);
          return;
        }
        addNewLink(message.commit.record.embed.external, message);
      }

      // Schedule next message processing if there are more messages
      if (messageQueueRef.current.length > 0) {
        const delay = remoteState.speed < 1 ? 1000 / remoteState.speed : 0;
        processingTimeoutRef.current = setTimeout(processMessageQueue, delay);
      } else {
        // No more messages, clear the timeout reference
        processingTimeoutRef.current = undefined;
      }
    } else {
      // Paused or no messages, clear the timeout reference
      processingTimeoutRef.current = undefined;
    }
  }, [addNewLink, remoteState.isPaused, remoteState.speed]);

  // Handle raw messages from firehose - just add to queue
  const handleMessage = useCallback(
    (message: any) => {
      if (message.commit?.record?.embed?.external) {
        messageQueueRef.current.push(message);

        // If we're not currently processing, start processing immediately
        if (!processingTimeoutRef.current && !remoteState.isPaused) {
          processingTimeoutRef.current = setTimeout(processMessageQueue, 0);
        }
      }
    },
    [processMessageQueue, remoteState.isPaused]
  );

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
    };
  }, []);

  // Handle pause/resume and speed changes
  useEffect(() => {
    if (
      !remoteState.isPaused &&
      messageQueueRef.current.length > 0 &&
      !processingTimeoutRef.current
    ) {
      // Resume processing
      processingTimeoutRef.current = setTimeout(processMessageQueue, 0);
    } else if (remoteState.isPaused && processingTimeoutRef.current) {
      // Pause processing
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = undefined;
    }
  }, [remoteState.isPaused, processMessageQueue]);

  useJetStream({
    wantedCollections: ["app.bsky.feed.post"],
    onMessage: handleMessage,
    onConnectionChange: setIsConnected,
  });

  // Filter links based on content filter
  const filteredLinks = useMemo(() => {
    return links.filter((link) =>
      shouldShowLink(link.url, remoteState.contentFilter)
    );
  }, [links, remoteState.contentFilter]);

  // Handle remote control state changes
  const handleRemoteStateChange = useCallback(
    (newState: Partial<RemoteControlState>) => {
      setRemoteState((prev) => ({ ...prev, ...newState }));
    },
    []
  );

  // Render different visual modes
  const renderContent = () => {
    if (remoteState.visualMode === "meteor") {
      return (
        <div style={{ display: "flex", gap: "2em" }}>
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                gap: ".5em",
                marginBottom: "1em",
                alignItems: "center",
              }}
            >
              <div>{isConnected ? "Connected" : "Disconnecting..."}</div>
            </div>
            <MeteorShower
              links={filteredLinks}
              speed={1}
              isPaused={remoteState.isPaused}
            />
          </div>
          <DomainHistogram domainCounts={domainCounts} />
        </div>
      );
    }

    if (remoteState.visualMode === "focus") {
      return (
        <div style={{ display: "flex", gap: "2em" }}>
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                gap: ".5em",
                marginBottom: "1em",
                alignItems: "center",
              }}
            >
              <div>{isConnected ? "Connected" : "Disconnecting..."}</div>
            </div>
            <FocusMode
              links={filteredLinks}
              speed={1}
              isPaused={remoteState.isPaused}
            />
          </div>
          <DomainHistogram domainCounts={domainCounts} />
        </div>
      );
    }

    // Default grid mode
    return (
      <div style={{ display: "flex", gap: "2em" }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              gap: ".5em",
              marginBottom: "1em",
              alignItems: "center",
            }}
          >
            <div>{isConnected ? "Connected" : "Disconnecting..."}</div>
          </div>
          <div
            className="stream-container"
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: "1em",
            }}
          >
            {filteredLinks.map((link) => (
              <LinkView key={link.postId} link={link} />
            ))}
          </div>
        </div>
        <DomainHistogram domainCounts={domainCounts} />
      </div>
    );
  };

  return (
    <>
      {renderContent()}

      <RemoteControl
        state={remoteState}
        onStateChange={handleRemoteStateChange}
      />
    </>
  );
}

export function LinkView({ link }: { link: LinkPost }) {
  const domain = new URL(link.url).hostname.replace(/^www\./, "");
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const bskyUrl = `https://bsky.app/profile/${link.postAuthor}/post/${link.postId}`;
  const postedTime = dayjs(link.timestamp / 1000).format("h:mm A"); // Convert microseconds to milliseconds, format as time

  // Truncate title if too long
  const displayTitle =
    link.title && link.title.length > 50
      ? `${link.title.substring(0, 50)}...`
      : link.title || domain;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <LinkPreview link={link} transformedUrl={transformUrl(link.url)} />

      {/* Polished metadata bar */}
      <div
        style={{
          width: "480px",
          padding: "12px 16px",
          backgroundColor: "#f8f9fa",
          borderRadius: "0 0 8px 8px",
          border: "1px solid #e9ecef",
          borderTop: "none",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "14px",
        }}
      >
        {/* Favicon */}
        <img
          src={favicon}
          alt={`${domain} favicon`}
          style={{
            width: "16px",
            height: "16px",
            borderRadius: "2px",
            flexShrink: 0,
          }}
          onError={(e) => {
            // Fallback to a default icon if favicon fails to load
            (e.target as HTMLImageElement).src =
              "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjNjY2NjY2Ii8+CjxwYXRoIGQ9Ik04IDRMMTIgOEw4IDEyTDQgOEw4IDRaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K";
          }}
        />

        {/* Title */}
        <span
          style={{
            flex: 1,
            fontWeight: "500",
            color: "#333",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={link.title || domain} // Show full title on hover
        >
          {displayTitle}
        </span>

        {/* BlueSky link */}
        <a
          href={bskyUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
            color: "#0066cc",
            fontSize: "16px",
            flexShrink: 0,
          }}
          title="View original BlueSky post"
        >
          <img
            src="/bluesky.svg"
            alt="BlueSky"
            style={{ width: "16px", height: "16px" }}
          />
        </a>

        {/* Posted time */}
        <span
          style={{
            color: "#666",
            fontSize: "12px",
            flexShrink: 0,
          }}
        >
          {postedTime}
        </span>
      </div>
    </div>
  );
}
