interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS?: string;
  // Shared secret required in the x-haiku-key header. When unset, the gate is
  // disabled (so the worker isn't locked out before the secret is configured).
  CLIENT_SECRET?: string;
}

interface GeneratedComment {
  name: string;
  handle: string;
  text: string;
}

// Normalize a model-proposed handle into a valid, unique username, or null.
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

// Turn a raw parsed entry into a validated comment, or null.
function toGeneratedComment(
  raw: unknown,
  takenHandles: Set<string>
): GeneratedComment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const text = obj.text;
  if (typeof text !== "string" || text.length === 0) return null;
  const handle = sanitizeHandle(obj.handle, takenHandles);
  if (!handle) return null;
  const name =
    typeof obj.name === "string" && obj.name.trim().length > 0
      ? obj.name.trim().slice(0, 30)
      : handle;
  return { name, handle, text: text.slice(0, 200) };
}

const SYSTEM_PROMPT = `You are simulating the reply section of a viral social media post. Write replies the way real people post online, NOT like an assistant.

STYLE:
- mostly lowercase, often a fragment rather than a full sentence
- minimal punctuation, dropped apostrophes ok (dont, im, youre)
- casual abbreviations ok (lol, fr, ngl, tbh, istg, w, no bc)
- no hashtags, emoji only occasionally

Include a varied mix:
- sincere supporters saying they felt it
- skeptics pushing back mildly
- people who completely missed the point
- jokes, puns, one-liners, a deadpan one-word reply
- tangential or off-topic responses
- self-promoters piggybacking
- people trying too hard to sound profound
- a slightly unhinged take

Vary the openers - do not start two replies the same way.

Each reply also has a poster identity:
- "name": a casual display name (first name, nickname, or username-y string). Keep it short.
- "handle": lowercase, letters/numbers/underscores only, no spaces, no @ (e.g. "mossy_creek", "jpeg2002", "ok_corral"). Never reuse a handle.

Output ONLY a JSON object in this exact shape, nothing else:
{"comments": [{"name": "...", "handle": "...", "text": "..."}, ...]}`;

function corsHeaders(origin: string | null, allowed: string | undefined): HeadersInit {
  const allowList = (allowed || "*").split(",").map((s) => s.trim());
  const allow = allowList.includes("*") || (origin && allowList.includes(origin))
    ? origin || "*"
    : allowList[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-haiku-key",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405, headers: cors });
    }
    // Gate on a shared secret so a found URL can't be used to run up the bill.
    if (env.CLIENT_SECRET && request.headers.get("x-haiku-key") !== env.CLIENT_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
    }

    let body: { post?: string; count?: number };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400, headers: cors });
    }

    const post = (body.post || "").toString().slice(0, 500);
    const count = Math.min(Math.max(Number(body.count) || 20, 1), 40);
    if (!post.trim()) {
      return Response.json({ error: "post is required" }, { status: 400, headers: cors });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: `Post: "${post}"\n\nGenerate ${count} varied replies.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: "anthropic error", detail: text.slice(0, 500) },
        { status: res.status, headers: cors }
      );
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    let comments: GeneratedComment[] = [];
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.comments)) {
          const taken = new Set<string>();
          comments = parsed.comments
            .map((c: unknown) => toGeneratedComment(c, taken))
            .filter((c: GeneratedComment | null): c is GeneratedComment => c !== null);
        }
      } catch {
        // ignore parse error, return empty
      }
    }

    return Response.json(
      { comments, usage: data.usage },
      { headers: { ...cors, "content-type": "application/json" } }
    );
  },
};
