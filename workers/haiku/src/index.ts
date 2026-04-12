interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS?: string;
}

const SYSTEM_PROMPT = `You are simulating the comment section of a viral social media post. Generate a diverse spread of short replies (1-2 sentences each). Include a varied mix of:

- sincere supporters saying they felt it
- skeptics pushing back mildly
- people who completely missed the point
- jokes, puns, and one-liners
- tangential or off-topic responses
- self-promoters piggybacking
- people trying too hard to sound profound
- typos, casual lowercase, dropped punctuation

Keep each reply short. Casual lowercase is fine. No hashtags. Vary the openers - do not start two replies the same way. Be surprising. Some replies should be unhinged.

Output ONLY a JSON object in this exact shape, nothing else:
{"comments": ["reply 1", "reply 2", "..."]}`;

function corsHeaders(origin: string | null, allowed: string | undefined): HeadersInit {
  const allowList = (allowed || "*").split(",").map((s) => s.trim());
  const allow = allowList.includes("*") || (origin && allowList.includes(origin))
    ? origin || "*"
    : allowList[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
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
    let comments: string[] = [];
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.comments)) {
          comments = parsed.comments.filter((c: unknown): c is string => typeof c === "string");
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
