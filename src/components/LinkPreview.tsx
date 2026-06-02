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
  const embedContainerRef = useRef<HTMLDivElement>(null);

  const domain = new URL(link.url).hostname.replace(/^www\./, "");

  // Check if this is a special embed type
  const isSpecialEmbed = transformedUrl.includes("_PLAYER:");
  const embedType = isSpecialEmbed ? transformedUrl.split("_PLAYER:")[0] : null;
  const originalUrl = isSpecialEmbed
    ? transformedUrl.split("_PLAYER:")[1]
    : null;

  useEffect(() => {
    if (isSpecialEmbed) {
      // Handle special embed types
      if (embedType === "TIKTOK" && originalUrl) {
        createTikTokPlayer(originalUrl);
      }
      return;
    }

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
  }, [link.url, loadState, isSpecialEmbed, embedType, originalUrl]);

  const createTikTokPlayer = async (url: string) => {
    if (!embedContainerRef.current) return;

    // Clear any existing content
    embedContainerRef.current.innerHTML = "";

    try {
      let videoId: string | undefined;

      // Handle full TikTok URLs: https://www.tiktok.com/@username/video/1234567890
      const fullUrlMatch = url.match(/\/video\/(\d+)/);
      if (fullUrlMatch) {
        videoId = fullUrlMatch[1];
      }

      // Handle short TikTok URLs: https://www.tiktok.com/t/ZP8SYkCCR/
      const shortUrlMatch = url.match(/\/t\/([^/]+)/);
      if (shortUrlMatch && !videoId) {
        // For short URLs, we need to resolve them to get the video ID
        try {
          const response = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
          });
          const resolvedUrl = response.url;
          const resolvedMatch = resolvedUrl.match(/\/video\/(\d+)/);
          if (resolvedMatch) {
            videoId = resolvedMatch[1];
          }
        } catch (e) {
          console.log("Failed to resolve TikTok short URL:", e);
        }
      }

      if (videoId) {
        // Create TikTok embed player iframe
        const iframe = document.createElement("iframe");
        iframe.src = `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&loop=1`;
        iframe.style.cssText = `
          border: none;
          border-radius: 8px;
        `;
        iframe.allow = "encrypted-media;";
        iframe.title = `TikTok video ${videoId}`;

        embedContainerRef.current.appendChild(iframe);
        setLoadState("loaded");
        return;
      }
    } catch (e) {
      console.log("Failed to create TikTok player:", e);
    }

    // Fallback if we couldn't get video ID
    const fallback = document.createElement("div");
    fallback.style.cssText = `
      border: 2px dashed #ccc;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      alignItems: center;
      background: #f8f9fa;
      text-align: center;
      padding: 20px;
    `;
    fallback.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">🎵</div>
      <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">TikTok Video</div>
      <a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #0066cc; text-decoration: none;">
        Click to view on TikTok
      </a>
    `;
    embedContainerRef.current.appendChild(fallback);
    setLoadState("loaded");
  };

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

  // Render special embed types
  if (isSpecialEmbed) {
    return (
      <div
        ref={embedContainerRef}
        style={{
          position: "relative",
          maxWidth: "480px",
          width: "100%",
          height: "320px",
        }}
      />
    );
  }

  // Check if this is an Instagram embed
  const isInstagramEmbed =
    transformedUrl.includes("instagram.com") &&
    transformedUrl.includes("/embed/");

  // Render regular iframe
  return (
    <div
      style={{
        position: "relative",
        overflow: isInstagramEmbed ? "hidden" : "visible",
        borderRadius: "8px",
      }}
    >
      <iframe
        ref={iframeRef}
        src={transformedUrl}
        style={{
          width: "100%",
          border: "none",
          borderRadius: "8px",
          position: isInstagramEmbed ? "absolute" : "static",
          top: isInstagramEmbed ? "0" : "auto",
          left: isInstagramEmbed ? "0" : "auto",
        }}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        sandbox="allow-scripts allow-forms"
        loading="lazy"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        title={`Preview of ${link.title || domain}`}
        scrolling="no"
      />
    </div>
  );
}
