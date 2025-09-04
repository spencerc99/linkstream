import { ContentFilter } from "../types";

// Helper function to normalize hostnames (remove www. prefix)
function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

// TV Mode: Video/visual content domains
const TV_DOMAINS = new Set([
  "youtube.com",
  "youtu.be", 
  "tiktok.com",
  "instagram.com",
  "vimeo.com",
  "twitch.tv",
  "netflix.com",
  "hulu.com",
  "disney.com",
  "dailymotion.com",
  "rumble.com"
]);

// Radio Mode: Audio-focused content domains
const RADIO_DOMAINS = new Set([
  "open.spotify.com",
  "spotify.com",
  "soundcloud.com", 
  "apple.com", // Apple Music links
  "music.youtube.com",
  "anchor.fm",
  "podcasts.apple.com", 
  "overcast.fm",
  "stitcher.com",
  "pocketcasts.com",
  "audible.com",
  "bandcamp.com",
  "last.fm"
]);

// Content type classification function
export function classifyContent(url: string): ContentFilter {
  try {
    const hostname = normalizeHostname(new URL(url).hostname);
    
    if (TV_DOMAINS.has(hostname)) {
      return "tv";
    }
    
    if (RADIO_DOMAINS.has(hostname)) {
      return "radio";
    }
    
    // Everything else is reader content
    return "reader";
  } catch {
    // Invalid URL defaults to reader
    return "reader";
  }
}

// Filter function to determine if a link should be shown based on current filter
export function shouldShowLink(url: string, activeFilter: ContentFilter): boolean {
  if (activeFilter === "all") {
    return true;
  }
  
  return classifyContent(url) === activeFilter;
}