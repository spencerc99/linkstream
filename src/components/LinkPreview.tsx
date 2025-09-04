import { useState, useRef, useEffect, useCallback } from "react";
import { LinkPost } from "../types";

// Suppress iframe-related console errors to avoid polluting the console
const originalConsoleError = console.error;
const suppressedErrors = [
  "Blocked a frame with origin",
  "X-Frame-Options",
  "Content Security Policy",
  "refused to connect",
  "ERR_BLOCKED_BY_RESPONSE",
  "Load denied by X-Frame-Options",
  "SAMEORIGIN",
  "DENY",
];

console.error = (...args) => {
  const message = args.join(" ");
  const shouldSuppress = suppressedErrors.some((error) =>
    message.toLowerCase().includes(error.toLowerCase())
  );

  if (!shouldSuppress) {
    originalConsoleError.apply(console, args);
  }
};

interface LinkPreviewProps {
  link: LinkPost;
  transformedUrl: string;
}

interface WaybackResponse {
  archived_snapshots: {
    closest?: {
      available: boolean;
      url: string;
      timestamp: string;
      status: string;
    };
  };
}

// Domains known to block iframe embedding
const IFRAME_BLOCKED_DOMAINS = new Set([
  "amazon.com",
  "apple.com",
  "google.com",
  "github.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "medium.com",
  "substack.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "wsj.com",
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "economist.com",
  "netflix.com",
  "hulu.com",
  "disney.com",
  "espn.com",
  "cnet.com",
  "techcrunch.com",
  "wired.com",
  "ars-technica.com",
  "stackoverflow.com",
  "stackexchange.com",
]);

export function LinkPreview({ link, transformedUrl }: LinkPreviewProps) {
  const [loadState, setLoadState] = useState<
    | "loading"
    | "loaded"
    | "failed"
    | "wayback-loading"
    | "wayback-loaded"
    | "wayback-failed"
  >("loading");
  const [waybackUrl, setWaybackUrl] = useState<string | null>(null);
  const [hasAttemptedWayback, setHasAttemptedWayback] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<number>();

  const domain = new URL(link.url).hostname.replace(/^www\./, "");
  const isKnownBlocked = IFRAME_BLOCKED_DOMAINS.has(domain);

  // Function to fetch archived version from Wayback Machine
  const fetchWaybackUrl = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(
        `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
      );
      const data: WaybackResponse = await response.json();

      if (data.archived_snapshots.closest?.available) {
        // Remove wayback header by adding 'id_' after the timestamp
        const archivedUrl = data.archived_snapshots.closest.url;
        const cleanUrl = archivedUrl.replace(/\/web\/(\d+)\//, "/web/$1id_/");
        return cleanUrl;
      }
      return null;
    } catch (error) {
      console.log("Failed to fetch Wayback URL:", error);
      return null;
    }
  };

  // Function to try Wayback Machine fallback
  const tryWaybackFallback = useCallback(() => {
    if (hasAttemptedWayback) {
      console.log("Already attempted Wayback for", link.url);
      return;
    }

    console.log("Trying Wayback Machine fallback for", link.url);
    setHasAttemptedWayback(true);
    setLoadState("wayback-loading");

    fetchWaybackUrl(link.url).then((url) => {
      if (url) {
        setWaybackUrl(url);
        setLoadState("wayback-loaded");
      } else {
        setLoadState("wayback-failed");
      }
    });

    // Add domain to blocked list for future use
    IFRAME_BLOCKED_DOMAINS.add(domain);
  }, [hasAttemptedWayback, link.url, domain]);

  useEffect(() => {
    if (isKnownBlocked) {
      // Skip straight to Wayback Machine for known blocked domains
      tryWaybackFallback();
      return;
    }

    // Set a timeout for iframe loading
    timeoutRef.current = window.setTimeout(() => {
      if (loadState === "loading" && !hasAttemptedWayback) {
        console.log("Iframe timeout for", link.url);
        tryWaybackFallback();
      }
    }, 5000); // 5 second timeout

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [
    domain,
    isKnownBlocked,
    link.url,
    loadState,
    hasAttemptedWayback,
    tryWaybackFallback,
  ]);

  const handleIframeLoad = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Additional check to see if iframe actually loaded content
    const iframe = iframeRef.current;
    if (iframe) {
      // Set up a delayed check to detect "refused to connect" and similar errors
      setTimeout(() => {
        try {
          // Try to access iframe content to detect X-Frame-Options blocks
          const iframeDoc =
            iframe.contentDocument || iframe.contentWindow?.document;

          if (!iframeDoc || iframeDoc.location.href === "about:blank") {
            console.log("Iframe blocked by security policy for", link.url);
            if (!hasAttemptedWayback) {
              tryWaybackFallback();
            }
            return;
          }

          // Check if the document has actual content (not just browser error pages)
          const bodyText = iframeDoc.body?.textContent?.toLowerCase() || "";
          const titleText = iframeDoc.title?.toLowerCase() || "";
          const documentHtml =
            iframeDoc.documentElement?.innerHTML?.toLowerCase() || "";

          // Common error indicators - expanded list
          const errorIndicators = [
            "refused to connect",
            "this site can't be reached",
            "connection was refused",
            "error 403",
            "access denied",
            "blocked",
            "not allowed to display",
            "x-frame-options",
            "cannot be displayed in a frame",
            "site refuses to connect",
            "err_connection_refused",
            "err_blocked_by_response",
            "net::err_",
            "this webpage is not available",
            "unable to connect",
            "connection timed out",
            "failed to load resource",
            "mixed content",
            "insecure content blocked",
            "content security policy",
          ];

          const hasError = errorIndicators.some(
            (indicator) =>
              bodyText.includes(indicator) ||
              titleText.includes(indicator) ||
              documentHtml.includes(indicator)
          );

          // Additional check: if body is empty or very minimal, it might be an error page
          const hasMinimalContent =
            (!iframeDoc.body ||
              iframeDoc.body.children.length === 0 ||
              bodyText.trim().length < 10) &&
            iframeDoc.location.href !== "about:blank";

          if (hasError || hasMinimalContent) {
            console.log(
              "Iframe shows error/minimal content for",
              link.url,
              "- trying Wayback"
            );
            if (!hasAttemptedWayback) {
              tryWaybackFallback();
            }
            return;
          }
        } catch (e) {
          // Cross-origin access blocked - this is actually expected for successful loads
          // If we can't access the content due to CORS, it means the page loaded successfully
          console.log(
            "Iframe loaded successfully (cross-origin) for",
            link.url
          );
        }

        // If we get here, the iframe appears to have loaded successfully
        console.log("Iframe loaded successfully for", link.url);
        setLoadState("loaded");
      }, 500); // 500ms delay to let the iframe content fully render
    }
  };

  const handleIframeError = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    console.log("Iframe error for", link.url);
    // Iframe failed to load, try Wayback Machine as fallback
    if (!hasAttemptedWayback) {
      tryWaybackFallback();
    }
  };

  const handleWaybackLoad = () => {
    setLoadState("wayback-loaded");
  };

  const handleWaybackError = () => {
    setLoadState("wayback-failed");
  };

  // Loading state for original iframe
  if (loadState === "loading" || loadState === "loaded") {
    return (
      <div style={{ position: "relative" }}>
        <iframe
          ref={iframeRef}
          src={transformedUrl}
          style={{
            width: "480px",
            height: "320px",
            border: "none",
            borderRadius: "8px",
          }}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          sandbox="allow-scripts allow-same-origin allow-forms"
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          title={`Preview of ${link.title || domain}`}
        />
      </div>
    );
  }

  // Wayback loading state
  if (loadState === "wayback-loading") {
    return (
      <div
        style={{
          width: "480px",
          height: "320px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#f8f9fa",
          gap: "8px",
        }}
      >
        <div>📚</div>
        <div>Loading archived version...</div>
      </div>
    );
  }

  // Show Wayback Machine iframe
  if (loadState === "wayback-loaded" && waybackUrl) {
    return (
      <div style={{ position: "relative" }}>
        <iframe
          src={waybackUrl}
          style={{
            width: "480px",
            height: "320px",
            border: "none",
            borderRadius: "8px",
          }}
          onLoad={handleWaybackLoad}
          onError={handleWaybackError}
          sandbox="allow-scripts allow-same-origin allow-forms"
          loading="lazy"
          referrerPolicy="no-referrer"
          title={`Archived preview of ${link.title || domain}`}
        />
        {/* Small indicator that this is archived content */}
        <div
          style={{
            position: "absolute",
            top: "4px",
            right: "4px",
            backgroundColor: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "2px 6px",
            borderRadius: "3px",
            fontSize: "0.7em",
            zIndex: 10,
          }}
        >
          📚 Archived
        </div>
      </div>
    );
  }

  // Final state: if Wayback also failed, show nothing (or minimal indicator)
  // Removed the final fallback as requested
  return (
    <div
      style={{
        width: "480px",
        height: "320px",
        border: "1px solid #ddd",
        borderRadius: "8px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#f8f9fa",
        fontSize: "0.9em",
        color: "#666",
      }}
    >
      Preview unavailable
    </div>
  );
}
