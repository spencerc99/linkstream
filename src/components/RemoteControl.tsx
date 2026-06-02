import { VisualMode, ContentFilter, RemoteControlState } from "../types";

interface RemoteControlProps {
  state: RemoteControlState;
  onStateChange: (newState: Partial<RemoteControlState>) => void;
}

export function RemoteControl({ state, onStateChange }: RemoteControlProps) {
  const handleVisualModeChange = (mode: VisualMode) => {
    onStateChange({ visualMode: mode });
  };

  const handleContentFilterChange = (filter: ContentFilter) => {
    onStateChange({ contentFilter: filter });
  };

  const handlePlayPause = () => {
    onStateChange({ isPaused: !state.isPaused });
  };

  // Visual mode icons and labels
  const visualModeConfig: Record<VisualMode, { icon: string; label: string }> =
    {
      grid: { icon: "▦", label: "GRID" },
      focus: { icon: "⊙", label: "FOCUS" },
      meteor: { icon: "☄", label: "METEOR" },
    };

  // Content filter icons and labels
  const contentFilterConfig: Record<
    ContentFilter,
    { icon: string; label: string }
  > = {
    all: { icon: "◉", label: "ALL" },
    tv: { icon: "▣", label: "TV" },
    radio: { icon: "◐", label: "RADIO" },
    flipbook: { icon: "◘", label: "FLIPBOOK" },
  };

  const handleSpeedUp = () => {
    const newSpeed = Math.min(1, state.speed + 0.25);
    onStateChange({ speed: newSpeed });
  };

  const handleSpeedDown = () => {
    const newSpeed = Math.max(0.25, state.speed - 0.25);
    onStateChange({ speed: newSpeed });
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "linear-gradient(145deg, #2c2c2c, #1c1c1c)",
        padding: "20px",
        borderRadius: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        alignItems: "center",
        fontFamily: "monospace",
        fontSize: "16px",
        zIndex: 1000,
        boxShadow:
          "0 8px 24px rgba(0, 0, 0, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.05)",
        border: "3px solid #444",
      }}
    >
      {/* Main Control Area */}
      <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
        {/* Left Column: Visual Modes & Content Filters */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Visual Mode Buttons */}
          <div style={{ display: "flex", gap: "8px" }}>
            {(["grid", "focus", "meteor"] as VisualMode[]).map((mode) => {
              const config = visualModeConfig[mode];
              const isActive = state.visualMode === mode;

              return (
                <div
                  key={mode}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <button
                    onClick={() => handleVisualModeChange(mode)}
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "8px",
                      border: "none",
                      background: isActive
                        ? "linear-gradient(145deg, #555, #333)"
                        : "linear-gradient(145deg, #4a4a4a, #3a3a3a)",
                      color: isActive ? "#ff6b35" : "#ccc",
                      cursor: "pointer",
                      fontSize: "18px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.1s ease",
                      boxShadow: isActive
                        ? "inset 0 3px 6px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(255,255,255,0.05)"
                        : "0 3px 6px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.1)",
                      transform: isActive ? "translateY(2px)" : "translateY(0)",
                    }}
                    onMouseDown={(e) => {
                      (e.target as HTMLElement).style.transform =
                        "translateY(3px)";
                    }}
                    onMouseUp={(e) => {
                      (e.target as HTMLElement).style.transform = isActive
                        ? "translateY(2px)"
                        : "translateY(0)";
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLElement).style.transform = isActive
                        ? "translateY(2px)"
                        : "translateY(0)";
                    }}
                  >
                    {config.icon}
                  </button>
                  <div
                    style={{
                      color: isActive ? "#ff6b35" : "#999",
                      fontSize: "8px",
                      fontWeight: "bold",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {config.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Content Filter Buttons */}
          <div style={{ display: "flex", gap: "6px" }}>
            {(["all", "tv", "radio", "flipbook"] as ContentFilter[]).map(
              (filter) => {
                const config = contentFilterConfig[filter];
                const isActive = state.contentFilter === filter;

                return (
                  <div
                    key={filter}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <button
                      onClick={() => handleContentFilterChange(filter)}
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "6px",
                        border: "none",
                        background: isActive
                          ? "linear-gradient(145deg, #555, #333)"
                          : "linear-gradient(145deg, #4a4a4a, #3a3a3a)",
                        color: isActive ? "#4a9eff" : "#ccc",
                        cursor: "pointer",
                        fontSize: "14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.1s ease",
                        boxShadow: isActive
                          ? "inset 0 3px 6px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(255,255,255,0.05)"
                          : "0 3px 6px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.1)",
                        transform: isActive
                          ? "translateY(2px)"
                          : "translateY(0)",
                      }}
                      onMouseDown={(e) => {
                        (e.target as HTMLElement).style.transform =
                          "translateY(3px)";
                      }}
                      onMouseUp={(e) => {
                        (e.target as HTMLElement).style.transform = isActive
                          ? "translateY(2px)"
                          : "translateY(0)";
                      }}
                      onMouseLeave={(e) => {
                        (e.target as HTMLElement).style.transform = isActive
                          ? "translateY(2px)"
                          : "translateY(0)";
                      }}
                    >
                      {config.icon}
                    </button>
                    <div
                      style={{
                        color: isActive ? "#4a9eff" : "#999",
                        fontSize: "8px",
                        fontWeight: "bold",
                        letterSpacing: "0.5px",
                      }}
                    >
                      {config.label}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* Right Column: Playback Controls */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            alignItems: "center",
            marginTop: "12px",
          }}
        >
          {/* Play/Pause Button */}
          <button
            onClick={handlePlayPause}
            style={{
              width: "60px",
              height: "60px",
              borderRadius: "50%",
              border: "none",
              background: state.isPaused
                ? "linear-gradient(145deg, #2ed573, #26c362)"
                : "linear-gradient(145deg, #ff4757, #e84057)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              transition: "all 0.1s ease",
              boxShadow:
                "0 4px 8px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,255,255,0.2)",
            }}
            onMouseDown={(e) => {
              (e.target as HTMLElement).style.transform = "translateY(2px)";
            }}
            onMouseUp={(e) => {
              (e.target as HTMLElement).style.transform = "translateY(0)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            {state.isPaused ? (
              <img src="/play.svg" height={40} width={40} color="white" />
            ) : (
              "⏸"
            )}
          </button>

          {/* Speed Controls */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* Speed Down Button */}
            <button
              onClick={handleSpeedDown}
              disabled={state.speed <= 0.25}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "6px",
                border: "none",
                background:
                  state.speed <= 0.25
                    ? "linear-gradient(145deg, #2a2a2a, #1a1a1a)"
                    : "linear-gradient(145deg, #4a4a4a, #3a3a3a)",
                color: state.speed <= 0.25 ? "#555" : "#ccc",
                cursor: state.speed <= 0.25 ? "not-allowed" : "pointer",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.1s ease",
                boxShadow:
                  "0 3px 6px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.1)",
              }}
              onMouseDown={(e) => {
                if (state.speed > 0.25) {
                  (e.target as HTMLElement).style.transform = "translateY(2px)";
                }
              }}
              onMouseUp={(e) => {
                (e.target as HTMLElement).style.transform = "translateY(0)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.transform = "translateY(0)";
              }}
            >
              ≪
            </button>

            {/* Speed Display */}
            <div
              style={{
                backgroundColor: "rgba(0,0,0,0.3)",
                padding: "6px 10px",
                borderRadius: "4px",
                color: "#fff",
                fontSize: "10px",
                fontWeight: "bold",
                letterSpacing: "0.5px",
                minWidth: "50px",
                textAlign: "center",
              }}
            >
              {state.speed}×
            </div>

            {/* Speed Up Button */}
            <button
              onClick={handleSpeedUp}
              disabled={state.speed >= 1}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "6px",
                border: "none",
                background:
                  state.speed >= 1
                    ? "linear-gradient(145deg, #2a2a2a, #1a1a1a)"
                    : "linear-gradient(145deg, #4a4a4a, #3a3a3a)",
                color: state.speed >= 1 ? "#555" : "#ccc",
                cursor: state.speed >= 1 ? "not-allowed" : "pointer",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.1s ease",
                boxShadow:
                  "0 3px 6px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.1)",
              }}
              onMouseDown={(e) => {
                if (state.speed < 1) {
                  (e.target as HTMLElement).style.transform = "translateY(2px)";
                }
              }}
              onMouseUp={(e) => {
                (e.target as HTMLElement).style.transform = "translateY(0)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.transform = "translateY(0)";
              }}
            >
              ≫
            </button>
          </div>
          {/* Project Title at Bottom */}
          <div
            style={{
              color: "#999",
              fontSize: "12px",
              fontWeight: "bold",
              letterSpacing: "1px",
              fontFamily: "monospace",
              marginTop: "auto",
            }}
          >
            LINKSTREAM
          </div>
        </div>
      </div>
    </div>
  );
}
