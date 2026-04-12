export const HAIKU_WORKER_URL: string | undefined = import.meta.env
  .VITE_HAIKU_WORKER_URL;

export async function generateHaikuComments(
  post: string,
  count: number
): Promise<string[]> {
  if (!HAIKU_WORKER_URL) return [];
  try {
    const res = await fetch(HAIKU_WORKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post, count }),
    });
    if (!res.ok) {
      console.error("Haiku worker error:", res.status, await res.text());
      return [];
    }
    const data = (await res.json()) as { comments?: unknown };
    if (!Array.isArray(data.comments)) return [];
    return data.comments.filter(
      (c: unknown): c is string => typeof c === "string" && c.length > 0
    );
  } catch (e) {
    console.error("Haiku fetch failed:", e);
    return [];
  }
}
