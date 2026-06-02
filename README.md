# experiments — spencer

A small collection of social/network experiments, indexed as a lab notebook
at `/`. Built with Vite + React + TypeScript, deployed as a static SPA on
Cloudflare Pages.

## Experiments

| Route               | What it is                                                  | Backing |
| ------------------- | ----------------------------------------------------------- | ------- |
| `/`                 | The notebook index                                          | —       |
| `/HAH/linkstream`   | A firehose of links surfacing from Bluesky in real time     | atproto |
| `/HAH/messages`     | Bluesky posts rerouted as DMs; sign in to reply for real    | atproto |
| `/HAH/poster`       | Post once, watch it go viral                                | atproto |
| `/HAH/void`         | Speak into the dark; it listens                             | local   |

## Develop

```sh
bun install
bun run dev    # http://127.0.0.1:5173
```

The dev server binds to `127.0.0.1` (not `localhost`) because AT Proto OAuth
requires `127.0.0.1` in loopback redirect URIs. In local dev, sign-in uses the
loopback client config — no deployed `client-metadata.json` needed.

### Environment

Copy `.env.example` to `.env.local` and fill in as needed:

- `VITE_HAIKU_WORKER_URL` — deployed `workers/haiku` URL; enables Haiku mode on
  the Poster experiment. Optional.
- `VITE_OAUTH_ORIGIN` — canonical production origin (no trailing slash). Only
  needed for production builds with a custom domain; see Deploy below.

## Deploy (Cloudflare Pages)

This is a pure static SPA plus one independent Worker (`workers/haiku`).

### 1. Deploy the haiku Worker (optional, for Poster's Haiku mode)

```sh
cd workers/haiku
bunx wrangler secret put ANTHROPIC_API_KEY
bunx wrangler deploy
```

Note the resulting `*.workers.dev` URL for the Pages env var below.

### 2. Create the Pages project

Connect the repo in the Cloudflare dashboard (Workers & Pages → Pages → Connect
to Git), with:

- **Build command:** `bun run build`
- **Output directory:** `dist`
- **Root directory:** repo root
- **Environment variables:**
  - `VITE_HAIKU_WORKER_URL` = the Worker URL from step 1 (optional)
  - `VITE_OAUTH_ORIGIN` = leave **unset** for the first deploy

Cloudflare auto-detects `bun.lock` and installs with Bun. The SPA catch-all is
handled by `public/_redirects` (`/* /index.html 200`); real static files like
`/client-metadata.json` are served directly.

### 3. First deploy → `*.pages.dev`

On the first build, `VITE_OAUTH_ORIGIN` is unset, so the build falls back to
`CF_PAGES_URL` (the auto-provided `*.pages.dev` origin) and bakes it into
`dist/client-metadata.json`. OAuth works on `*.pages.dev` immediately. Verify:

```sh
curl https://<project>.pages.dev/client-metadata.json   # substituted, not index.html
```

### 4. Attach the custom domain

Add `atproto.spencer.place` (Pages → Custom domains) and wait for the cert.
Then:

1. Set Pages env var `VITE_OAUTH_ORIGIN=https://atproto.spencer.place` and
   **redeploy** (the origin is baked at build time, so an env change needs a
   rebuild).
2. Add a redirect so `*.pages.dev` → the custom domain. OAuth `client_id` is
   derived from `location.origin` at runtime and must match the baked metadata,
   so all real traffic should land on the one canonical origin.
3. Tighten the Worker: set `ALLOWED_ORIGINS` in `workers/haiku/wrangler.toml`
   to the custom domain (+ `http://127.0.0.1:5173` for local) and redeploy.

> Note: `atproto.spencer.place` is the candidate domain. The Void is purely
> local (not atproto-backed), so the name is a loose umbrella, not a claim that
> every experiment uses the protocol.
