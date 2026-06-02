import { useEffect, useState, useCallback } from "react";
import { LinkPost } from "../types";
import { LinkView } from "../StreamView";

interface FocusModeProps {
  links: LinkPost[];
  speed: number;
  isPaused: boolean;
}

export function FocusMode({ links, speed, isPaused }: FocusModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Calculate delay based on speed (inverse relationship)
  const delayMs = Math.max(1000, 5000 / speed); // 5s at 1x, 2.5s at 2x, 10s at 0.5x

  const goToNext = useCallback(() => {
    if (links.length === 0) return;
    setCurrentIndex(prev => (prev + 1) % links.length);
  }, [links.length]);

  const goToPrev = useCallback(() => {
    if (links.length === 0) return;
    setCurrentIndex(prev => (prev - 1 + links.length) % links.length);
  }, [links.length]);

  // Auto-advance logic
  useEffect(() => {
    if (isPaused || links.length === 0) {
      if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        setAutoAdvanceTimer(null);
      }
      return;
    }

    const timer = setTimeout(goToNext, delayMs);
    setAutoAdvanceTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [currentIndex, isPaused, delayMs, goToNext, links.length, autoAdvanceTimer]);

  // Reset index when links change significantly
  useEffect(() => {
    if (currentIndex >= links.length && links.length > 0) {
      setCurrentIndex(0);
    }
  }, [links.length, currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goToNext();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [goToNext, goToPrev]);

  if (links.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "70vh",
          fontSize: "18px",
          color: "#666",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div>{isPaused ? "⏸ Paused" : "⌛ Waiting for links..."}</div>
        <div style={{ fontSize: "14px", color: "#999" }}>
          Use arrow keys to navigate when links appear
        </div>
      </div>
    );
  }

  const currentLink = links[currentIndex];

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "20px",
        minHeight: "70vh",
        padding: "20px",
      }}
    >
      {/* Navigation buttons */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "20px",
          transform: "translateY(-50%)",
          zIndex: 10,
        }}
      >
        <button
          onClick={goToPrev}
          style={{
            width: "50px",
            height: "50px",
            borderRadius: "50%",
            border: "2px solid rgba(0, 0, 0, 0.2)",
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            color: "#333",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = "#fff";
            (e.target as HTMLElement).style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = "rgba(255, 255, 255, 0.9)";
            (e.target as HTMLElement).style.transform = "scale(1)";
          }}
        >
          ‹
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          top: "50%",
          right: "20px",
          transform: "translateY(-50%)",
          zIndex: 10,
        }}
      >
        <button
          onClick={goToNext}
          style={{
            width: "50px",
            height: "50px",
            borderRadius: "50%",
            border: "2px solid rgba(0, 0, 0, 0.2)",
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            color: "#333",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = "#fff";
            (e.target as HTMLElement).style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = "rgba(255, 255, 255, 0.9)";
            (e.target as HTMLElement).style.transform = "scale(1)";
          }}
        >
          ›
        </button>
      </div>

      {/* Main content */}
      <div
        style={{
          transform: "scale(1.2)", // Make it larger than grid mode
          transformOrigin: "center",
        }}
      >
        <LinkView link={currentLink} />
      </div>

      {/* Progress indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          color: "#666",
          fontSize: "14px",
        }}
      >
        <span>
          {currentIndex + 1} of {links.length}
        </span>
        
        {!isPaused && (
          <>
            <span>•</span>
            <span>Auto-advance in {Math.ceil(delayMs / 1000)}s</span>
          </>
        )}
        
        <span>•</span>
        <span style={{ fontSize: "12px", color: "#999" }}>
          Use ← → keys to navigate
        </span>
      </div>

      {/* Background blur for other content (optional) */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(248, 249, 250, 0.8)",
          backdropFilter: "blur(3px)",
          zIndex: -1,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}