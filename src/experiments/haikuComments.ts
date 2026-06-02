import type { GeneratedComment } from "./useLocalLLM";

export const HAIKU_WORKER_URL: string | undefined = import.meta.env
  .VITE_HAIKU_WORKER_URL;

const HAIKU_KEY: string | undefined = import.meta.env.VITE_HAIKU_KEY;

export async function generateHaikuComments(
  post: string,
  count: number
): Promise<GeneratedComment[]> {
  if (!HAIKU_WORKER_URL) return [];
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (HAIKU_KEY) headers["x-haiku-key"] = HAIKU_KEY;
    const res = await fetch(HAIKU_WORKER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ post, count }),
    });
    if (!res.ok) {
      console.error("Haiku worker error:", res.status, await res.text());
      return [];
    }
    const data = (await res.json()) as { comments?: unknown };
    if (!Array.isArray(data.comments)) return [];
    return data.comments.filter(
      (c: unknown): c is GeneratedComment =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as GeneratedComment).text === "string" &&
        typeof (c as GeneratedComment).handle === "string" &&
        typeof (c as GeneratedComment).name === "string"
    );
  } catch (e) {
    console.error("Haiku fetch failed:", e);
    return [];
  }
}
