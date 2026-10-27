# Deployment

f(kill) has two independently deployable pieces:

1. **The SvelteKit frontend** — solo play, CPU matches, the editor and canvas.
   Build it as static files or with a server adapter.
2. **The authoritative relay** — a Node WebSocket process that owns online rooms
   and matches. Online play is unavailable without it; the frontend does not
   pretend otherwise.

Solo play needs no relay, no database and no account system.

## 1. Build targets

`vite.config.ts` selects an adapter through `FKILL_ADAPTER`:

| Value | Adapter | Output | Use |
| --- | --- | --- | --- |
| `static` | `@sveltejs/adapter-static` | `build/` | Vercel/Cloudflare Pages static, any file host |
| `vercel` | `@sveltejs/adapter-vercel` | `.vercel/output/` | Vercel serverless deployment |
| `cloudflare` | `@sveltejs/adapter-cloudflare` | `.svelte-kit/cloudflare` | Cloudflare Pages/Workers deployment |
| `node` | `@sveltejs/adapter-node` | `build/` | self-hosted Node server |
| unset | `adapter-auto` | host-dependent | auto-detection |

Cross-platform commands:

```bash
npm run build:static
npm run build:vercel
npm run build:cloudflare
npm run build:node
```

The static build prerenders the landing page and settings shell and emits
`index.html`, `settings.html` and a `200.html` SPA fallback. `/lobby` and
`/play` are client-side routes; they must be served through that fallback.

### Verification performed

- `FKILL_ADAPTER=static npm run build` — passes; output includes `index.html`,
  `settings.html`, `200.html`.
- `FKILL_ADAPTER=cloudflare npm run build` — passes.
- `FKILL_ADAPTER=vercel npm run build` — the adapter itself needs symlink
  support. On Windows without Developer Mode this fails with `EPERM: symlink`.
  Build it on Vercel or on Linux/macOS/CI; alternatively use the static build.
- Static output was previewed locally; `/`, `/settings`, `/lobby` and `/play`
  return 200 with the fallback.

## 2. Environment variables

Frontend (baked at **build** time — rebuild after changing):

```bash
# WebSocket endpoint of the authoritative relay.
# Default when unset: ws://localhost:8787/ws
VITE_FKILL_RELAY_URL=wss://relay.example.com/ws
```

Relay (read at **runtime**):

```bash
PORT=8787
# Comma-separated browser origins allowed to open a socket. Empty = allow all.
FKILL_ALLOWED_ORIGIN=https://fkill.example.com,https://www.fkill.example.com
```

There are no private secrets in the frontend bundle. The relay URL is public.
`FKILL_ALLOWED_ORIGIN` is an origin check, not authentication.

## 3. Static frontend (solo + CPU)

```bash
VITE_FKILL_RELAY_URL=wss://relay.example.com/ws npm run build:static
```

Upload the contents of `build/` to any static host.

### Vercel (static)

- Framework preset: **Other** (or SvelteKit with output override).
- Build command: `npm run build:static`
- Output directory: `build`
- Add a rewrite for client routes to `/200.html` (these can be configured in
  `vercel.json` or the project dashboard):

```json
{
  "rewrites": [
    { "source": "/lobby", "destination": "/200.html" },
    { "source": "/play", "destination": "/200.html" }
  ]
}
```

The prerendered `/` and `/settings` files are served directly.

### Cloudflare Pages (static)

- Build command: `npm run build:static`
- Build output directory: `build`
- Add an SPA fallback `_redirects` file to the uploaded output:

```text
/* /200.html 200
```

The repository does not ship a host-specific redirects file by default because
the same `build/` output is used elsewhere; add it in the Pages project or copy
it into the output during your CI step.

Without the fallback, `/lobby` and `/play` will 404 on a plain file server even
though the game works from `/`.

### Offline use

A static build with no relay URL still plays solo/CPU. The online tab reports
that it cannot connect instead of silently pretending to be online.

## 4. Dynamic frontend (server adapter)

### Vercel

```bash
npm run build:vercel
```

Deploy the generated `.vercel/output`. On Vercel's Linux builder the symlink step
succeeds. This is a normal SvelteKit deployment; the game engine is still
client-side. **Online rooms are not hosted inside Vercel functions** in this
build; point `VITE_FKILL_RELAY_URL` at the relay.

### Cloudflare

```bash
npm run build:cloudflare
```

Deploy the adapter output with Wrangler/Pages. The SvelteKit app runs on the
Workers runtime. The authoritative WebSocket relay in this repository is a Node
process and is **not** deployed as a Worker; use an external Node relay for
online play. No Cloudflare Durable Object implementation is included.

### Node

```bash
npm run build:node
PORT=3000 node build
```

Serve it behind TLS. The relay remains a separate process and port; do not
confuse the app server with the game authority.

## 5. Relay

```bash
npm run build:relay          # esbuild bundle: server/dist/authority.mjs
PORT=8787 \
FKILL_ALLOWED_ORIGIN=https://fkill.example.com \
node server/relay.mjs
```

- HTTP: `GET /health` → `{ ok, rooms, protocol }`; `GET /` → text.
- WebSocket: `/ws`.
- Protocol version: `1`. Version mismatches are rejected by the browser client.
- Rooms live in memory only. A restart loses open rooms; there is no database.
  Run a **single instance** (or add a shared store/sticky routing) because room
  state is process-local.
- Graceful shutdown on SIGINT/SIGTERM closes sockets.
- Put it behind a TLS-terminating proxy and use `wss://` from the browser.
- Set `FKILL_ALLOWED_ORIGIN` in production. It is a coarse origin allow-list,
  not user authentication.
- Rates: 60 messages per 10 s per socket, 96 KiB maximum payload, plus the
  engine's FFA submission limits.

### Suitable hosts

Any Node 20+ host that supports long-lived WebSockets: a VPS, Railway, Render,
Fly.io, a container platform, or a dedicated Node service. Configure health
checks against `/health` and only one replica unless room state is externalised.

## 6. Local development

```bash
npm install
npm run dev          # app on :5173
npm run relay        # relay on :8787 (separate terminal)
```

The default relay URL points at `ws://localhost:8787/ws`. If you serve the app
from another origin/port, set `FKILL_ALLOWED_ORIGIN` accordingly or leave it
empty for local development.

## 7. Quality gates before deploying

```bash
npm run check
npm run lint
npm test
npm run build:static
npm run relay:smoke   # requires a running relay
```

`npm test` currently runs 130 tests. The relay smoke test uses two real
WebSocket clients and verifies create/join/ready/start/attack/reconnect. The UI
flows (solo match, invalid equation, accepted attack, two-player online room)
were additionally exercised with a headless browser during development; those
browser scripts are not committed as a CI dependency.
