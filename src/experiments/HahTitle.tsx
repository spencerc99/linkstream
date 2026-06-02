// The "HAH" wordmark that comes to life: hover twitches it, click makes it
// laugh — googly eyes, an open mouth, a synthesized "heh-heh", and a spill of
// HAHAHA that scatters across the page. Calls onLaugh so the page can react.

import { useCallback, useRef, useState } from "react";

interface Spill {
  id: number;
  text: string;
  dx: number;
  dy: number;
  rot: number;
  scale: number;
}

const SPILL_TEXTS = ["HA", "HAHA", "ha", "HAHAHA", "haha", "HA!", "hahaha"];

// Lazily-created shared audio context (browsers require a user gesture first).
let audioCtx: AudioContext | null = null;

function playLaugh(): number[] {
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtx = new Ctx();
    }
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();

    // A laugh is a handful of quick descending "ha" blips with a little
    // random pitch wobble so no two laughs sound the same. We collect the
    // start time of each syllable (in ms from now) and return it so the
    // caller can sync visuals to the exact rhythm of the audio.
    const syllables = 4 + Math.floor(Math.random() * 3);
    const base = 240 + Math.random() * 80;
    const start = ctx.currentTime;
    let t = start;
    const beats: number[] = [];

    for (let i = 0; i < syllables; i++) {
      beats.push((t - start) * 1000);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";

      const pitch = base * (1 + (Math.random() - 0.5) * 0.2) - i * 8;
      osc.frequency.setValueAtTime(pitch * 1.5, t);
      osc.frequency.exponentialRampToValueAtTime(pitch, t + 0.08);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
      t += 0.12 + Math.random() * 0.04;
    }
    return beats;
  } catch {
    // Audio not available — fail silently, the visual still plays.
    return [];
  }
}

export function HahTitle({ onLaugh }: { onLaugh?: () => void }) {
  const [laughing, setLaughing] = useState(false);
  const [spills, setSpills] = useState<Spill[]>([]);
  const spillId = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  const laugh = useCallback(() => {
    const beats = playLaugh();
    setLaughing(true);

    // Pulse the page (background glyph shudder) once per audio syllable, so
    // the shake is locked to the rhythm of the laugh. Fall back to a single
    // pulse if audio gave us no beats.
    if (beats.length > 0) {
      for (const ms of beats) {
        setTimeout(() => onLaugh?.(), ms);
      }
    } else {
      onLaugh?.();
    }

    // Spew a burst of HAHAHA in random directions.
    const burst: Spill[] = Array.from({ length: 9 }, () => ({
      id: spillId.current++,
      text: SPILL_TEXTS[Math.floor(Math.random() * SPILL_TEXTS.length)],
      dx: (Math.random() - 0.35) * 360,
      dy: -40 - Math.random() * 220,
      rot: (Math.random() - 0.5) * 80,
      scale: 0.7 + Math.random() * 1.3,
    }));
    setSpills((prev) => [...prev, ...burst]);
    setTimeout(() => {
      const ids = new Set(burst.map((b) => b.id));
      setSpills((prev) => prev.filter((s) => !ids.has(s.id)));
    }, 1400);

    // Keep the face laughing until just after the last syllable.
    const lastBeat = beats.length > 0 ? beats[beats.length - 1] : 600;
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setLaughing(false), lastBeat + 300);
  }, [onLaugh]);

  return (
    <span className={`hah ${laughing ? "hah--laughing" : ""}`}>
      <button
        type="button"
        className="hah__word"
        onClick={laugh}
        aria-label="HAH (click to laugh)"
      >
        <span className="hah__letter hah__h">
          H
          <span className="hah__eye">
            <span className="hah__pupil" />
          </span>
        </span>
        <span className="hah__letter hah__a">
          A
          <span className="hah__mouth" />
        </span>
        <span className="hah__letter hah__h">
          H
          <span className="hah__eye">
            <span className="hah__pupil" />
          </span>
        </span>
      </button>

      <span className="hah__spills" aria-hidden="true">
        {spills.map((s) => (
          <span
            key={s.id}
            className="hah__spill"
            style={
              {
                "--dx": `${s.dx}px`,
                "--dy": `${s.dy}px`,
                "--rot": `${s.rot}deg`,
                "--scale": s.scale,
              } as React.CSSProperties
            }
          >
            {s.text}
          </span>
        ))}
      </span>
    </span>
  );
}
