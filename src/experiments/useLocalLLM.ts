import { useCallback, useRef, useState } from "react";
import type { MLCEngine } from "@mlc-ai/web-llm";

export type LocalLLMStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unsupported";

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const SYSTEM_PROMPT = `You are simulating the reply section of a viral social media post. Write replies the way real people post online, NOT like an assistant.

STYLE RULES (follow strictly):
- mostly lowercase, including the first word. capital letters only for emphasis or proper nouns
- short and punchy. often a fragment, not a full sentence. one clause is fine
- skip apostrophes sometimes (dont, im, thats, youre)
- casual abbreviations ok: lol, lmao, fr, ngl, istg, tbh, idk, w, L, no bc, this
- minimal punctuation. periods optional. trailing thoughts are fine
- no hashtags. emoji only occasionally (most replies have none)

Examples of the right voice:
- "ok but why is this so real"
- "not me reading this at 3am 💀"
- "nah this is actually crazy"
- "ok and? lol"
- "the way i GASPED"
- "wait who asked though"
- "this is the only correct opinion"

Mix the crowd: hype repliers, people mildly disagreeing, someone missing the point, a joke, a deadpan one-word reply, a slightly unhinged take.

Each reply also has a poster identity:
- "name": a casual display name (a first name, a nickname, or a lowercase username-y handle). Keep it short.
- "handle": lowercase, letters/numbers/underscores only, no spaces, no @. Make it feel like a real internet handle (e.g. "mossy_creek", "jpeg2002", "ok_corral", "saltdog").

Vary the names and handles a lot. Do not reuse the same handle twice.

Output ONLY a JSON object:
{"comments": [{"name": "...", "handle": "...", "text": "..."}, ...]}`;

// maxLength caps each field so a single string can't run away into a paragraph
// of degenerate text (valid JSON, but incoherent for a 1B model). The handle
// pattern forces a sane username shape.
const RESPONSE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    comments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 30 },
          handle: { type: "string", maxLength: 20, pattern: "^[a-z0-9_]+$" },
          text: { type: "string", maxLength: 160 },
        },
        required: ["name", "handle", "text"],
      },
    },
  },
  required: ["comments"],
});

// A 1B model occasionally derails into word-salad mid-string. Drop replies
// that look incoherent: too long, or built from runs of non-alphabetic tokens.
// Tuned to keep casual lowercase/low-punctuation replies, which are wanted.
function looksCoherent(comment: string): boolean {
  if (comment.length > 180) return false;
  const words = comment.trim().split(/\s+/);
  if (words.length === 0) return false;
  // A real reply is short; a long run-on is the derailment signature.
  if (words.length > 20) return false;
  // High ratio of tokens with interior digits/symbols means token soup.
  // Strip surrounding punctuation first so "and?" or "💀" don't count.
  const junkWords = words.filter((w) => {
    const core = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return core.length > 0 && /[^a-zA-Z'’-]/.test(core);
  }).length;
  if (junkWords / words.length > 0.4) return false;
  return true;
}

export interface GeneratedComment {
  name: string;
  handle: string;
  text: string;
}

// The grammar-constrained JSON is always valid when generation finishes, but
// hitting max_tokens mid-array truncates it. Salvage the complete objects by
// matching balanced {...} entries and parsing each independently.
function salvageComments(text: string): unknown[] {
  const objects: unknown[] = [];
  const objectPattern = /\{[^{}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(text)) !== null) {
    try {
      objects.push(JSON.parse(match[0]));
    } catch {
      // Ignore fragments that don't decode cleanly.
    }
  }
  return objects;
}

// Normalize an LLM-proposed handle into a valid, unique username. Returns null
// if nothing usable remains.
function sanitizeHandle(raw: unknown, taken: Set<string>): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  if (handle.length < 2) return null;
  let candidate = handle;
  let suffix = 1;
  while (taken.has(candidate)) {
    candidate = `${handle}${suffix}`.slice(0, 20);
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

// Turn a raw parsed entry into a validated GeneratedComment, or null.
function toGeneratedComment(
  raw: unknown,
  takenHandles: Set<string>
): GeneratedComment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const text = obj.text;
  if (typeof text !== "string" || text.length === 0 || !looksCoherent(text)) {
    return null;
  }
  const handle = sanitizeHandle(obj.handle, takenHandles);
  if (!handle) return null;
  const name =
    typeof obj.name === "string" && obj.name.trim().length > 0
      ? obj.name.trim().slice(0, 30)
      : handle;
  return { name, handle, text };
}

export function useLocalLLM() {
  const [status, setStatus] = useState<LocalLLMStatus>(
    typeof navigator !== "undefined" && !("gpu" in navigator)
      ? "unsupported"
      : "idle"
  );
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<MLCEngine | null>(null);

  const load = useCallback(async () => {
    if (engineRef.current || status === "loading" || status === "unsupported") {
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
      const engine = await CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (p) => {
          setProgress(p.progress);
          setProgressText(p.text);
        },
      });
      engineRef.current = engine;
      setStatus("ready");
    } catch (e) {
      console.error("WebLLM load failed:", e);
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [status]);

  const generate = useCallback(
    async (post: string, count: number): Promise<GeneratedComment[]> => {
      if (!engineRef.current) return [];
      try {
        const resp = await engineRef.current.chat.completions.create({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Post: "${post}"\n\nGenerate ${count} varied replies, each with its own name and handle.`,
            },
          ],
          temperature: 0.7,
          top_p: 0.9,
          frequency_penalty: 0.3,
          max_tokens: 1400,
          response_format: { type: "json_object", schema: RESPONSE_SCHEMA },
        });
        const text = resp.choices[0]?.message?.content || "";
        let raw: unknown;
        try {
          raw = JSON.parse(text).comments;
        } catch {
          // Generation truncated at max_tokens before the JSON closed.
          raw = salvageComments(text);
        }
        if (!Array.isArray(raw)) return [];
        const takenHandles = new Set<string>();
        return raw
          .map((entry) => toGeneratedComment(entry, takenHandles))
          .filter((c): c is GeneratedComment => c !== null);
      } catch (e) {
        console.error("WebLLM generate failed:", e);
        return [];
      }
    },
    []
  );

  return { status, progress, progressText, error, load, generate };
}
