import type { GeneratedComment } from "./useLocalLLM";

export const HAIKU_WORKER_URL: string | undefined = import.meta.env
  .VITE_HAIKU_WORKER_URL;

const HAIKU_KEY_STORAGE = "hah.poster.anthropicKey";

// The user's Anthropic key is kept only in their own browser's localStorage and
// sent per-request to the relay worker. It is never stored server-side.
export function loadStoredApiKey(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(HAIKU_KEY_STORAGE) || "";
}

export function storeApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(HAIKU_KEY_STORAGE, key);
    else localStorage.removeItem(HAIKU_KEY_STORAGE);
  } catch {
    // ignore storage errors
  }
}

export class HaikuError extends Error {}

export async function generateHaikuComments(
  post: string,
  count: number,
  apiKey: string
): Promise<GeneratedComment[]> {
  if (!HAIKU_WORKER_URL) throw new HaikuError("Haiku worker URL not configured");
  if (!apiKey) throw new HaikuError("Add your Anthropic API key to use Haiku");

  const res = await fetch(HAIKU_WORKER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-anthropic-key": apiKey,
    },
    body: JSON.stringify({ post, count }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: string; detail?: string };
      detail = err.detail || err.error || "";
    } catch {
      // non-JSON error body
    }
    if (res.status === 401) {
      throw new HaikuError(
        detail.includes("missing") ? "Add your Anthropic API key" : "Invalid API key"
      );
    }
    throw new HaikuError(detail || `Haiku worker error (${res.status})`);
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
}
