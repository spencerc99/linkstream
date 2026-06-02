import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { LinkPost, ExternalEmbed } from "./types";
import { useJetStream } from "./hooks/useJetStream";
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
  "www.youtube.com": (url: string) => URL_TRANSFORMERS["youtube.com"](url),
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
};

// Helper function to transform URLs
function transformUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    const transformer = URL_TRANSFORMERS[domain];
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

      // Update domain counts
      const domain = new URL(external.uri).hostname;
      setDomainCounts((prev) => ({
        ...prev,
        [domain]: (prev[domain] || 0) + 1,
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
          <Link to="/" style={{ textDecoration: "none" }}>
            &larr; index
          </Link>
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

      {/* New Domain Histogram */}
      <div
        style={{
          width: "200px",
          padding: "1em",
          borderLeft: "1px solid #ccc",
        }}
      >
        <h3>Domain Statistics</h3>
        {Object.entries(domainCounts)
          .sort(([, a], [, b]) => b - a) // Sort by count descending
          .map(([domain, count]) => (
            <div key={domain} style={{ marginBottom: "0.5em" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{domain}</span>
                <span>{count}</span>
              </div>
              <div
                style={{
                  width: `${
                    (count / Math.max(...Object.values(domainCounts))) * 100
                  }%`,
                  height: "4px",
                  backgroundColor: "#0066cc",
                  borderRadius: "2px",
                }}
              />
            </div>
          ))}
      </div>
    </div>
  );
}

export function LinkView({ link }: { link: LinkPost }) {
  return (
    <div style={{}}>
      <iframe src={transformUrl(link.url)} />
      <p>{dayjs(link.timestamp).format("hh:mm:ss a")}</p>
      {/* Hidden until clicked to expand */}
      <div className="detailInfo" style={{ display: "none" }}>
        <a href={link.url}>{link.title}</a>
        <p>({link.description})</p>
      </div>
    </div>
  );
}
