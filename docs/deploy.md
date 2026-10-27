# Deploying

Three supported targets. `bun run cli init` sets up any of them interactively; this page explains what it does and
how to do it by hand.

## Before you start

1. A Marzban server you can reach, and its sudo admin credentials.
2. A domain pointing at the machine that will run the panel (needed for HTTPS, and Telegram requires HTTPS).
3. Generate two secrets: `openssl rand -base64 32` for `BETTER_AUTH_SECRET`, and another for `MARZBAN_WEBHOOK_SECRET`.

## A. Docker + Bun (recommended for a VPS)

`init` writes `.env` and a `docker-compose.yml` like this (Caddy only if you gave a domain):

```yaml
services:
  panel:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_PATH: /data/panel.db
      BACKUP_DIR: /data/backups
    volumes:
      - panel-data:/data
    expose: ['3000'] # or ports: ["3000:3000"] without Caddy
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ['80:80', '443:443']
    command: caddy reverse-proxy --from panel.example.com --to panel:3000
    volumes: [caddy-data:/data]
    depends_on: [panel]
volumes:
  panel-data:
  caddy-data:
```

```bash
docker compose up -d --build
docker compose run --rm panel bun run cli create-admin --email you@example.com
docker compose run --rm panel bun run cli doctor
```

- The image runs as a non-root user, keeps all state in the `/data` volume, and has a health check on `GET /api/health`.
- Migrations run automatically when the container starts.
- Caddy sets `X-Forwarded-For`, which the login and customer-page rate limits rely on. If you use another proxy, make
  sure it sets that header, otherwise every visitor shares one rate-limit bucket.

## B. Bun directly

```bash
bun install --frozen-lockfile
cp .env.example .env     # fill in, or run: bun run cli init
bun run build
bun run cli migrate
bun run cli create-admin --email you@example.com
bun run start            # listens on :3000 (set PORT to change)
```

Run it under a supervisor so it restarts and starts on boot, e.g. systemd:

```ini
[Service]
WorkingDirectory=/opt/vpn-panel
EnvironmentFile=/opt/vpn-panel/.env
ExecStart=/usr/local/bin/bun run start
Restart=always
User=vpnpanel
```

Put a reverse proxy (Caddy/nginx) in front for HTTPS.

## C. Cloudflare Workers + D1

```bash
cp wrangler.example.jsonc wrangler.jsonc
bunx wrangler d1 create vpn-panel-db            # paste the database_id into wrangler.jsonc
bun run db:migrate:remote                       # = wrangler d1 migrations apply DB --remote
for k in BETTER_AUTH_SECRET BETTER_AUTH_URL BOOTSTRAP_ADMIN_EMAIL MARZBAN_BASE_URL \
         MARZBAN_USERNAME MARZBAN_PASSWORD MARZBAN_WEBHOOK_SECRET; do bunx wrangler secret put $k; done
bun run deploy
```

Create the first admin by opening `/login` (it shows the bootstrap form while the database is empty and only accepts
`BOOTSTRAP_ADMIN_EMAIL`).

**Limits on Cloudflare:** the background jobs (periodic Marzban sync, automatic backups, Telegram sending and the
expiry/traffic/wallet scans) do **not** run, because they live in the Bun server process. Telegram messages are queued
but never sent until you add cron triggers that call `scanNotifications`/`drainNotifications` from `src/lib/jobs.ts`.
Use `wrangler d1 export` for backups. The `backup`/`restore` CLI commands are for the SQLite file only.

## Marzban webhooks

Add to Marzban's `.env` (the wizard prints exactly these lines) and restart Marzban:

```
WEBHOOK_ADDRESS = "https://panel.example.com/api/webhooks/marzban"
WEBHOOK_SECRET = "<MARZBAN_WEBHOOK_SECRET>"
```

Webhooks keep user status and usage current between the 10-minute background syncs. A failed delivery returns 503 so
Marzban retries; two simultaneous deliveries of the same event are processed once.

## Telegram

1. In Telegram, ask **@BotFather** for a new bot and copy the token.
2. In the panel: **اعلان‌ها** → bot settings → paste the token and the bot username, switch it on, save.
3. Press **ثبت وب‌هوک در تلگرام**. This needs `BETTER_AUTH_URL` to be an `https://` address Telegram can reach.
4. Each person links their own chat from the same page (one-time code, valid 15 minutes).

The bot token is stored encrypted and is never shown again. Messages are sent as plain text.

## Backups and restore

- **Automatic:** the Bun server writes a backup every 24 hours to `BACKUP_DIR` (default `./backups`; the Docker image
  uses `/data/backups`, so backups live on the volume) and keeps the newest `BACKUP_KEEP` (14). Copy that directory
  off the machine; a backup on the same disk is not a backup.
- **Manual:** `bun run cli backup --out /safe/place/panel.db`.
- **Restore:** stop the panel, `bun run cli restore /safe/place/panel.db`, start it. The previous file is kept as
  `panel.db.pre-restore`.

Backups contain encrypted secrets; they are only readable with the same `BETTER_AUTH_SECRET`. Keep that value safe too.

## Upgrading

```bash
git pull
docker compose build && docker compose up -d      # or: bun install && bun run build && restart
```

Migrations apply on start. Take a backup first (`bun run cli backup`). Migrations are forward-only.

## Troubleshooting

| Symptom                                                  | Check                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Container exits immediately with "Invalid configuration" | `BETTER_AUTH_SECRET` ≥ 32 chars and `BETTER_AUTH_URL` set                                                                |
| Everyone gets "too many requests"                        | Reverse proxy not forwarding `X-Forwarded-For`                                                                           |
| Customers see "link invalid"                             | Link was regenerated, revoked or expired; make a new one from the customer dialog                                        |
| Telegram messages never arrive                           | Bot enabled? Webhook registered over HTTPS? User linked? See the outbox counts and last errors on the notifications page |
| Users out of date                                        | Marzban reachable? `bun run cli doctor`; check the webhook lines in Marzban's `.env`                                     |
| Blank page in `bun run dev`                              | Vite re-optimizing dependencies; wait and reload                                                                         |
| Settings/tokens suddenly unreadable                      | `BETTER_AUTH_SECRET` changed; re-enter the bot token and gateway credentials                                             |
