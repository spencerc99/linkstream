import { useCallback, useState } from "react";
import { LinkPost, ExternalEmbed } from "./types";
import { useJetStream } from "./hooks/useJetStream";
import { DomainHistogram } from "./components/DomainHistogram";
import { LinkPreview } from "./components/LinkPreview";
import dayjs from "dayjs";

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
  const [isPaused, setIsPaused] = useState(false);
  const [domainCounts, setDomainCounts] = useState<DomainCounts>({});

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

  const handleMessage = useCallback(
    (message: any) => {
      if (isPaused) {
        console.log("Paused, skipping message");
        return;
      }
      if (message.commit?.record?.embed?.external) {
        // skip if it is a bsky link
        if (
          message.commit.record.embed.external.uri.startsWith(
            "https://bsky.social"
          )
        ) {
          return;
        }
        addNewLink(message.commit.record.embed.external, message);
      }
    },
    [addNewLink, isPaused]
  );

  useJetStream({
    wantedCollections: ["app.bsky.feed.post"],
    onMessage: handleMessage,
    onConnectionChange: setIsConnected,
  });

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
          <button onClick={() => setIsPaused((prev) => !prev)}>
            {isPaused ? "Resume" : "Pause"}
          </button>
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
          {links.map((link) => (
            <LinkView key={link.postId} link={link} />
          ))}
        </div>
      </div>

      <DomainHistogram domainCounts={domainCounts} />
    </div>
  );
}

export function LinkView({ link }: { link: LinkPost }) {
  return (
    <div style={{}}>
      <LinkPreview link={link} transformedUrl={transformUrl(link.url)} />
      <p>{dayjs(link.timestamp).format("hh:mm:ss a")}</p>
      {/* Hidden until clicked to expand */}
      <div className="detailInfo" style={{ display: "none" }}>
        <a href={link.url}>{link.title}</a>
        <p>({link.description})</p>
      </div>
    </div>
  );
}
