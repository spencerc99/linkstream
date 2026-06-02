import { useEffect, useState, useRef } from "react";
import { LinkPost } from "../types";

interface MeteorShowerProps {
  links: LinkPost[];
  speed: number;
  isPaused: boolean;
}

interface FallingFavicon {
  id: string;
  url: string;
  domain: string;
  favicon: string;
  x: number;
  y: number;
  createdAt: number;
}

const FAVICON_SIZE = 24;
const FALL_SPEED = 2; // Base pixels per animation frame
const LIFETIME = 30000; // 30 seconds before favicon disappears

export function MeteorShower({ links, speed, isPaused }: MeteorShowerProps) {
  const [fallingFavicons, setFallingFavicons] = useState<FallingFavicon[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();

  // Add new favicons when links arrive
  useEffect(() => {
    if (!links.length || isPaused) return;

    const latestLink = links[0]; // Get the most recent link
    const domain = new URL(latestLink.url).hostname.replace(/^www\./, "");
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=${FAVICON_SIZE}`;

    const newFavicon: FallingFavicon = {
      id: latestLink.postId,
      url: latestLink.url,
      domain,
      favicon,
      x: Math.random() * (window.innerWidth - FAVICON_SIZE), // Random X position
      y: -FAVICON_SIZE, // Start above viewport
      createdAt: Date.now(),
    };

    setFallingFavicons(prev => {
      // Check if this favicon already exists (avoid duplicates)
      const exists = prev.some(f => f.id === newFavicon.id);
      if (exists) return prev;
      
      return [newFavicon, ...prev];
    });
  }, [links, isPaused]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      if (isPaused) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const now = Date.now();
      const containerHeight = window.innerHeight;

      setFallingFavicons(prev => {
        return prev
          .map(favicon => ({
            ...favicon,
            y: favicon.y + (FALL_SPEED * speed), // Apply speed multiplier
          }))
          .filter(favicon => {
            // Remove favicons that have fallen off screen or exceeded lifetime
            const isVisible = favicon.y < containerHeight + FAVICON_SIZE;
            const isAlive = (now - favicon.createdAt) < LIFETIME;
            return isVisible && isAlive;
          });
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [speed, isPaused]);

  const handleFaviconClick = (favicon: FallingFavicon) => {
    // Open the original URL when favicon is clicked
    window.open(favicon.url, '_blank');
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "70vh", // Take up most of the viewport
        overflow: "hidden",
        backgroundColor: "#f8f9fa",
        borderRadius: "8px",
        cursor: "crosshair",
      }}
    >
      {/* Background text when no favicons */}
      {fallingFavicons.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#999",
            fontSize: "18px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAlign: "center",
          }}
        >
          {isPaused ? "⏸️ Paused" : "🌟 Waiting for links..."}
        </div>
      )}

      {/* Falling favicons */}
      {fallingFavicons.map((favicon) => (
        <div
          key={favicon.id}
          onClick={() => handleFaviconClick(favicon)}
          style={{
            position: "absolute",
            left: `${favicon.x}px`,
            top: `${favicon.y}px`,
            width: `${FAVICON_SIZE}px`,
            height: `${FAVICON_SIZE}px`,
            cursor: "pointer",
            transition: "transform 0.1s ease",
            borderRadius: "4px",
            backgroundColor: "white",
            padding: "4px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
            border: "1px solid rgba(0, 0, 0, 0.1)",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.transform = "scale(1.2)";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.transform = "scale(1)";
          }}
          title={`${favicon.domain} - Click to open`}
        >
          <img
            src={favicon.favicon}
            alt={`${favicon.domain} favicon`}
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "2px",
            }}
            onError={(e) => {
              // Fallback to a default icon if favicon fails to load
              (e.target as HTMLImageElement).src =
                "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjNjY2NjY2Ii8+CjxwYXRoIGQ9Ik04IDRMMTIgOEw4IDEyTDQgOEw4IDRaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K";
            }}
          />
        </div>
      ))}
    </div>
  );
}