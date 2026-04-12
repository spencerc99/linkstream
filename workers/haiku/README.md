# linkstream-haiku

Tiny Cloudflare Worker that proxies comment generation through Claude Haiku 4.5.
Accepts `{ post, count }`, returns `{ comments: string[] }`.

Uses prompt caching on the system prompt so per-post cost drops to ~$0.003 after
the first call.

## Setup

```bash
cd workers/haiku
bun install
bunx wrangler login            # once
bunx wrangler secret put ANTHROPIC_API_KEY
bunx wrangler deploy
```

Copy the deployed URL (e.g. `https://linkstream-haiku.yoursubdomain.workers.dev`)
and add it to the project root `.env.local`:

```
VITE_HAIKU_WORKER_URL=https://linkstream-haiku.yoursubdomain.workers.dev
```

## Restricting origins

Edit `ALLOWED_ORIGINS` in `wrangler.toml` to your deployed site origin:

```toml
[vars]
ALLOWED_ORIGINS = "https://yoursite.com,http://localhost:5173"
```

Then redeploy.

## Local dev

```bash
bun run dev    # runs on http://localhost:8787
```

Point `.env.local` at the local URL to test.
