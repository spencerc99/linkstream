import { useState, useRef, useEffect } from "react";
import { LinkPost } from "../types";

// Type for Instagram embed script
declare global {
  interface Window {
    instgrm?: {
      Embeds: {
        process(): void;
      };
    };
  }
}

// Cache for resolved TikTok URLs to avoid repeat requests
const tiktokUrlCache = new Map<string, string>();

// Queue for TikTok URL resolution with rate limiting
class TikTokResolver {
  private static queue: Array<{
    url: string;
    resolve: (videoId: string | null) => void;
  }> = [];
  private static processing = false;
  private static lastRequest = 0;
  private static readonly DELAY_MS = 1000; // 1 second between requests

  static async resolveUrl(url: string): Promise<string | null> {
    // Check cache first
    if (tiktokUrlCache.has(url)) {
      return tiktokUrlCache.get(url) || null;
    }

    return new Promise((resolve) => {
      this.queue.push({ url, resolve });
      this.processQueue();
    });
  }

  private static async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequest;

      if (timeSinceLastRequest < this.DELAY_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.DELAY_MS - timeSinceLastRequest)
        );
      }

      const { url, resolve } = this.queue.shift()!;

      try {
        const response = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
        });

        const resolvedUrl = response.url;
        const resolvedMatch = resolvedUrl.match(/\/video\/(\d+)/);
        const videoId = resolvedMatch ? resolvedMatch[1] : null;

        // Cache the result
        if (videoId) {
          tiktokUrlCache.set(url, videoId);
        }

        resolve(videoId);
        this.lastRequest = Date.now();
      } catch (e) {
        console.log("Failed to resolve TikTok short URL:", e);

        // Since client-side resolution is unreliable due to CORS,
        // let's try a different approach: Use public CORS proxies
        const corsProxies = [
          "https://api.allorigins.win/get?url=",
          "https://corsproxy.io/?",
        ];

        for (const proxy of corsProxies) {
          console.log("url", url);
          try {
            console.log(`Trying CORS proxy: ${proxy}`);
            const proxyUrl = proxy + encodeURIComponent(url);
            const response = await fetch(proxyUrl);

            if (response.ok) {
              const data = await response.json();
              // Try to extract video ID from the response
              console.log("data", data);
              // const videoIdMatch = data.match(/video[\/:](\d{19})/);
              // if (videoIdMatch) {
              //   const videoId = videoIdMatch[1];
              //   console.log(`Resolved via proxy ${proxy}: ${videoId}`);
              //   tiktokUrlCache.set(url, videoId);
              //   resolve(videoId);
              //   this.lastRequest = Date.now();
              //   return;
              // }
            }
          } catch (proxyError) {
            console.log(`Proxy ${proxy} failed:`, proxyError);
          }
        }

        resolve(null);
      }
    }

    this.processing = false;
  }
}

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
      } else if (embedType === "INSTAGRAM" && originalUrl) {
        createInstagramPlayer(originalUrl);
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
  }, []);

  const createTikTokPlayer = async (url: string) => {
    if (!embedContainerRef.current) return;

    // Clear any existing content
    embedContainerRef.current.innerHTML = "";

    let videoId: string | undefined;
    let shortUrlMatch: RegExpMatchArray | null = null;

    try {
      // Handle full TikTok URLs: https://www.tiktok.com/@username/video/1234567890
      const fullUrlMatch = url.match(/\/video\/(\d+)/);
      if (fullUrlMatch) {
        videoId = fullUrlMatch[1];
      }

      // Handle short TikTok URLs: https://www.tiktok.com/t/ZP8SYkCCR/
      shortUrlMatch = url.match(/\/t\/([^/]+)/);
      if (shortUrlMatch && !videoId) {
        // For short URLs, use the rate-limited resolver
        videoId = await TikTokResolver.resolveUrl(url);
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
      width: 480px;
      height: 320px;
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

  const createInstagramPlayer = async (url: string) => {
    if (!embedContainerRef.current) return;

    // Clear any existing content
    embedContainerRef.current.innerHTML = "";

    try {
      // Create blockquote element that Instagram's embed.js will process
      const blockquote = document.createElement("blockquote");
      blockquote.className = "instagram-media";
      blockquote.setAttribute("data-instgrm-permalink", url);
      blockquote.setAttribute("data-instgrm-version", "14");
      blockquote.style.cssText = `
        background: #FFF;
        border: 0;
        border-radius: 3px;
        box-shadow: 0 0 1px 0 rgba(0,0,0,0.5), 0 1px 10px 0 rgba(0,0,0,0.15);
        margin: 1px;
        max-width: 540px;
        min-width: 326px;
        padding: 0;
        width: calc(100% - 2px);
      `;

      // Add fallback content for the blockquote
      blockquote.innerHTML = `
        <div style="padding: 16px;">
          <a href="${url}" style="background: #FFFFFF; line-height: 0; padding: 0 0; text-align: center; text-decoration: none; width: 100%;" target="_blank">
            <div style="display: flex; flex-direction: row; align-items: center;">
              <div style="background-color: #F4F4F4; border-radius: 50%; flex-grow: 0; height: 40px; margin-right: 14px; width: 40px;"></div>
              <div style="display: flex; flex-direction: column; flex-grow: 1; justify-content: center;">
                <div style="background-color: #F4F4F4; border-radius: 4px; flex-grow: 0; height: 14px; margin-bottom: 6px; width: 100px;"></div>
                <div style="background-color: #F4F4F4; border-radius: 4px; flex-grow: 0; height: 14px; width: 60px;"></div>
              </div>
            </div>
            <div style="padding: 19% 0;"></div>
            <div style="display: block; height: 50px; margin: 0 auto 12px; width: 50px;">
              <svg width="50px" height="50px" viewBox="0 0 60 60" version="1.1">
                <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
                  <g transform="translate(-511.000000, -20.000000)" fill="#000000">
                    <g><path d="M556.869,30.41 C554.814,30.41 553.148,32.076 553.148,34.131 C553.148,36.186 554.814,37.852 556.869,37.852 C558.924,37.852 560.59,36.186 560.59,34.131 C560.59,32.076 558.924,30.41 556.869,30.41 M541,60.657 C535.114,60.657 530.342,55.887 530.342,50 C530.342,44.114 535.114,39.342 541,39.342 C546.887,39.342 551.658,44.114 551.658,50 C551.658,55.887 546.887,60.657 541,60.657 M541,33.886 C532.1,33.886 524.886,41.1 524.886,50 C524.886,58.899 532.1,66.113 541,66.113 C549.9,66.113 557.115,58.899 557.115,50 C557.115,41.1 549.9,33.886 541,33.886 M565.378,62.101 C565.244,65.022 564.756,66.606 564.346,67.663 C563.803,69.06 563.154,70.057 562.106,71.106 C561.058,72.155 560.06,72.803 558.662,73.347 C557.607,73.757 556.021,74.244 553.102,74.378 C549.944,74.521 548.997,74.552 541,74.552 C533.003,74.552 532.056,74.521 528.898,74.378 C525.979,74.244 524.393,73.757 523.338,73.347 C521.94,72.803 520.942,72.155 519.894,71.106 C518.846,70.057 518.197,69.06 517.654,67.663 C517.244,66.606 516.755,65.022 516.623,62.101 C516.479,58.943 516.448,57.996 516.448,50 C516.448,42.003 516.479,41.056 516.623,37.899 C516.755,34.978 517.244,33.391 517.654,32.338 C518.197,30.938 518.846,29.942 519.894,28.894 C520.942,27.846 521.94,27.196 523.338,26.654 C524.393,26.244 525.979,25.756 528.898,25.623 C532.057,25.479 533.004,25.448 541,25.448 C548.997,25.448 549.943,25.479 553.102,25.623 C556.021,25.756 557.607,26.244 558.662,26.654 C560.06,27.196 561.058,27.846 562.106,28.894 C563.154,29.942 563.803,30.938 564.346,32.338 C564.756,33.391 565.244,34.978 565.378,37.899 C565.522,41.056 565.552,42.003 565.552,50 C565.552,57.996 565.522,58.943 565.378,62.101 M570.82,37.631 C570.674,34.438 570.167,32.258 569.425,30.349 C568.659,28.377 567.633,26.702 565.965,25.035 C564.297,23.368 562.623,22.342 560.652,21.575 C558.743,20.834 556.562,20.326 553.369,20.18 C550.169,20.033 549.148,20 541,20 C532.853,20 531.831,20.033 528.631,20.18 C525.438,20.326 523.257,20.834 521.349,21.575 C519.376,22.342 517.703,23.368 516.035,25.035 C514.368,26.702 513.342,28.377 512.574,30.349 C511.834,32.258 511.326,34.438 511.181,37.631 C511.035,40.831 511,41.851 511,50 C511,58.147 511.035,59.17 511.181,62.369 C511.326,65.562 511.834,67.743 512.574,69.651 C513.342,71.625 514.368,73.296 516.035,74.965 C517.703,76.634 519.376,77.658 521.349,78.425 C523.257,79.167 525.438,79.673 528.631,79.82 C531.831,79.965 532.853,80.001 541,80.001 C549.148,80.001 550.169,79.965 553.369,79.82 C556.562,79.673 558.743,79.167 560.652,78.425 C562.623,77.658 564.297,76.634 565.965,74.965 C567.633,73.296 568.659,71.625 569.425,69.651 C570.167,67.743 570.674,65.562 570.82,62.369 C570.966,59.17 571,58.147 571,50 C571,41.851 570.966,40.831 570.82,37.631"></path></g>
                  </g>
                </g>
              </svg>
            </div>
            <div style="padding-top: 8px;">
              <div style="color: #3897f0; font-family: Arial,sans-serif; font-size: 14px; font-style: normal; font-weight: 550; line-height: 18px;">View this post on Instagram</div>
            </div>
          </a>
        </div>
      `;

      // Create container with proper sizing
      const container = document.createElement("div");
      container.style.cssText = `
        width: 480px;
        height: 320px;
        overflow: hidden;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      container.appendChild(blockquote);
      embedContainerRef.current.appendChild(container);

      // Load Instagram's embed script if not already loaded
      if (!window.instgrm) {
        const script = document.createElement("script");
        script.src = "//www.instagram.com/embed.js";
        script.async = true;
        document.head.appendChild(script);
        script.onload = () => {
          if (window.instgrm) {
            window.instgrm.Embeds.process();
          }
        };
      } else {
        // Process embeds if script already loaded
        window.instgrm.Embeds.process();
      }

      setLoadState("loaded");
    } catch (e) {
      console.log("Failed to create Instagram embed:", e);

      // Fallback if embed creation fails
      const fallback = document.createElement("div");
      fallback.style.cssText = `
        width: 480px;
        height: 320px;
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
        <div style="font-size: 48px; margin-bottom: 16px;">📷</div>
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">Instagram Post</div>
        <a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #0066cc; text-decoration: none;">
          Click to view on Instagram
        </a>
      `;
      embedContainerRef.current.appendChild(fallback);
      setLoadState("loaded");
    }
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

  // Render regular iframe
  return (
    <div
      style={{
        position: "relative",
        borderRadius: "8px",
      }}
    >
      <iframe
        ref={iframeRef}
        src={transformedUrl}
        style={{
          width: "100%",
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
        scrolling="no"
      />
    </div>
  );
}
