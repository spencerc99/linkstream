import { useState, useRef, useEffect } from "react";
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

export function LinkPreview({ link, transformedUrl }: LinkPreviewProps) {
  const [loadState, setLoadState] = useState<"loading" | "loaded">("loading");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<number>();

  const domain = new URL(link.url).hostname.replace(/^www\./, "");

  useEffect(() => {
    // Set a timeout for iframe loading
    timeoutRef.current = window.setTimeout(() => {
      if (loadState === "loading") {
        console.log("Iframe timeout for", link.url);
        setLoadState("loaded"); // Just mark as loaded even if it timed out
      }
    }, 5000); // 5 second timeout

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [link.url, loadState]);

  const handleIframeLoad = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setLoadState("loaded");
  };

  const handleIframeError = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    console.log("Iframe error for", link.url);
    setLoadState("loaded"); // Still mark as loaded, let iframe handle the error display
  };

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
