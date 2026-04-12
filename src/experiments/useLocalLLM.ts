import { useCallback, useRef, useState } from "react";
import type { MLCEngine } from "@mlc-ai/web-llm";

export type LocalLLMStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unsupported";

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const SYSTEM_PROMPT = `You are simulating the comment section of a viral social media post. Generate a diverse spread of short replies (1-2 sentences each). Mix: sincere supporters, skeptics, people missing the point, jokes, tangential responses, self-promoters, typos, casual lowercase. No hashtags. Vary openers.

Output ONLY a JSON object: {"comments": ["reply 1", "reply 2", ...]}`;

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
    async (post: string, count: number): Promise<string[]> => {
      if (!engineRef.current) return [];
      try {
        const resp = await engineRef.current.chat.completions.create({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Post: "${post}"\n\nGenerate ${count} varied replies.`,
            },
          ],
          temperature: 1.0,
          max_tokens: 900,
        });
        const text = resp.choices[0]?.message?.content || "";
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return [];
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed.comments)) return [];
        return parsed.comments.filter(
          (c: unknown): c is string => typeof c === "string" && c.length > 0
        );
      } catch (e) {
        console.error("WebLLM generate failed:", e);
        return [];
      }
    },
    []
  );

  return { status, progress, progressText, error, load, generate };
}
