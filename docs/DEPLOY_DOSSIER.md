# Deploy Dossier Service to OVH

**Audience:** KD (or anyone with root on `51.178.209.131`)
**Goal:** Make AI Dossier work in production. The dossier service runs in `packages/server/` (Express + better-sqlite3 + background workers). It is currently dev-only — there's no Vercel function for it, and the OVH SSE relay only serves `/stream/*`. We need a long-running Node process exposing `/api/dossier/*` and the rest of `packages/server/`'s routes.

## Plan

1. New PM2 process on the existing OVH box (or a sibling box if RAM is tight)
2. New subdomain `api.spectreai.io` is taken by Alaa's data API — use `srv.spectreai.io` or `dossier.spectreai.io` instead
3. nginx reverse proxy: `srv.spectreai.io` -> `127.0.0.1:3001`
4. Set `VITE_DOSSIER_API=https://srv.spectreai.io` in Vercel env for `spectre-trading` and `spectre-research`, redeploy

The SSE relay at `stream.spectreai.io` stays as-is. They're independent.

## On the OVH server (51.178.209.131)

```bash
# 1. Pull the monorepo (if not already there)
cd /srv
sudo git clone https://github.com/Spectre-AI-Bot/spectre-app.git
cd spectre-app
sudo git checkout main

# Or if already cloned for sse-relay:
cd /srv/spectre-app && sudo git pull origin main

# 2. Install deps from monorepo root (npm workspaces)
sudo npm install --omit=dev=false

# better-sqlite3 needs build tools - if missing:
# sudo apt install -y build-essential python3
# Then `sudo npm rebuild better-sqlite3`

# 3. Create env file - copy keys from Vercel project settings
sudo nano /srv/spectre-app/.env
# Required minimum:
#   CODEX_API_KEY=<from Vercel>
#   GROQ_API_KEY=<get from Sunny / 1password>   # llama-3.3-70b-versatile drives lore generation
#   PORT=3001
#   DOSSIER_ENABLED=true
#   ADMIN_KEY=<random long string for /api/env-check>
# Optional (improves dossier quality):
#   DOSSIER_LORE_MODEL=llama-3.3-70b-versatile   # default already, override only if you want a different Groq model
#   GROQ_BASE_URL=https://api.groq.com/openai/v1 # default
#   COINGECKO_API_KEY, CRYPTOCOMPARE_API_KEY, CRYPTOPANIC_API_KEY,
#   FINNHUB_API_KEY, QUICKINTEL_API_KEY, ELEVENLABS_API_KEY
#   ANTHROPIC_API_KEY  # only for Monarch chat (separate feature, not dossier)

# 4. Persistent data volume for SQLite (dossier.db lives here)
sudo mkdir -p /srv/spectre-app/packages/server/data
sudo chown -R $USER /srv/spectre-app/packages/server/data

# 5. Start under PM2
pm2 start packages/server/index.js \
  --name spectre-server \
  --node-args="--max-old-space-size=2048" \
  --time
pm2 save
pm2 startup    # follow the printed command if PM2 isn't on systemd yet

# 6. Verify
curl -s http://127.0.0.1:3001/api/health | head -c 300
curl -s "http://127.0.0.1:3001/api/dossier/eth/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6?stream=true" | head -c 300
```

## nginx (new server block)

`/etc/nginx/sites-available/srv.spectreai.io`:

```nginx
server {
    listen 443 ssl http2;
    server_name srv.spectreai.io;

    ssl_certificate     /etc/letsencrypt/live/srv.spectreai.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/srv.spectreai.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    # Same SSE buffering disable as stream.spectreai.io for /api/dossier/*?stream=true
    location ~ ^/api/.*stream=true {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        chunked_transfer_encoding off;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # NOTE: do NOT add CORS headers here. Express already sets them via the
    # cors() middleware. Adding them in nginx too produces duplicate
    # Access-Control-Allow-Origin headers, which browsers reject.
}

server {
    listen 80;
    server_name srv.spectreai.io;
    return 301 https://$host$request_uri;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/srv.spectreai.io /etc/nginx/sites-enabled/
sudo certbot --nginx -d srv.spectreai.io
sudo nginx -t && sudo systemctl reload nginx
```

## Cloudflare DNS

`srv.spectreai.io` -> A record -> `51.178.209.131`
**Proxy: DISABLED (DNS-only)** - same as `stream.spectreai.io`. Cloudflare's proxy buffers SSE and breaks the dossier stream endpoint.

## Vercel env vars

For both `spectre-trading` and `spectre-research` projects, add (Production + Preview):

```
VITE_DOSSIER_API=https://srv.spectreai.io
```

Then redeploy. The frontend's `DossierStory.jsx` and `DossierFeed.jsx` already read this var (`(import.meta.env.VITE_DOSSIER_API || '') + '/api/dossier'`).

## Health checks

After deploy:
```bash
curl https://srv.spectreai.io/api/health
curl "https://srv.spectreai.io/api/dossier/eth/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6?stream=true" | head -c 1000
```

In the browser on https://spectre-trading.vercel.app/#token/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6 — open DevTools, Network tab, search "dossier" — should see 200s instead of 404s, and the right-panel "AI Dossier" block should populate.

## Memory / disk footprint

- RSS at idle: ~250 MB. Bumps to ~700 MB during dossier warmup (first 5 min after start).
- SQLite db grows roughly 50 MB / week of active use. Pre-allocate 5 GB on the data volume.
- Background workers run on intervals (warmup 6h, market 60s, scanner 3m, safety 2m, socials 5m, flows 5m, brain-signals 30s). All controlled by `DOSSIER_*_INTERVAL_MS` env vars - safe to leave at defaults.
- Lore generation hits Groq's `llama-3.3-70b-versatile` (cost is ~$0.0005 per token dossier — negligible at any reasonable volume). Rate limits: Groq free tier is 30 req/min, paid tier is 1000+ req/min. The socials_lore worker batches calls to stay under the limit.

## Rollback

```bash
pm2 stop spectre-server
pm2 delete spectre-server
sudo rm /etc/nginx/sites-enabled/srv.spectreai.io
sudo systemctl reload nginx
```

Then unset `VITE_DOSSIER_API` in Vercel and redeploy. Dossier UI returns to its current empty-state (404).

## Why not Vercel functions?

The dossier system has 20+ routes, persistent SQLite (`packages/server/data/dossier.db`), background workers, schedulers, brain annotations, lore generation via Anthropic, and event streaming. Vercel functions are stateless (no disk persistence between invocations) and capped at 300s per request. The background workers and SSE-style endpoints fundamentally can't run on serverless. Long-running Node + nginx is the right shape for this.
