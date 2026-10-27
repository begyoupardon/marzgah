# Marzban setup

The panel needs a Marzban **sudo admin** and (recommended) webhooks. The wizard (`bun run cli init`) does most of this;
this page is the manual version.

## 1. Panel configuration

In `.env` (Bun/Docker) or as Worker secrets (Cloudflare). Full reference: [README](../README.md#configuration).

```
MARZBAN_BASE_URL=https://your-marzban.example.com
MARZBAN_USERNAME=<sudo admin>
MARZBAN_PASSWORD=<sudo password>
MARZBAN_WEBHOOK_SECRET=<long random secret>
# only if the public subscription host differs from the API host:
# MARZBAN_SUBSCRIPTION_URL_PREFIX=https://sub.example.com
BOOTSTRAP_ADMIN_EMAIL=<your admin email>
BETTER_AUTH_URL=https://panel.example.com
BETTER_AUTH_SECRET=<32+ random characters>
```

Check it: `bun run cli doctor` logs in to Marzban and reports problems.

## 2. Marzban webhooks

In Marzban's `.env`, then restart Marzban:

```
WEBHOOK_ADDRESS = "https://panel.example.com/api/webhooks/marzban"
WEBHOOK_SECRET = "<same as MARZBAN_WEBHOOK_SECRET>"
```

The panel verifies the secret header, deduplicates by user + action + timestamp, and returns 503 on failure so Marzban
retries. For local testing, expose `http://localhost:3000/api/webhooks/marzban` with a tunnel (Cloudflare Tunnel, ngrok).

Without webhooks the panel still works: lists refresh live and a background sync runs every 10 minutes, but status
changes made directly in Marzban take longer to appear.

## 3. Database

SQLite migrations apply automatically on start. Manually: `bun run cli migrate` (SQLite) or
`bun run db:migrate:local` / `bun run db:migrate:remote` (Cloudflare D1, needs `wrangler.jsonc`).

## 4. First admin

Either `bun run cli create-admin --email you@example.com`, or set `BOOTSTRAP_ADMIN_EMAIL`, open `/login` on an empty
database and create the account (the email must match; public signup is disabled).

Then: admin creates sellers under **نمایندگان**; sellers sign in and manage customers under **کاربران VPN**.

## Behaviour to know

- Panel usernames are `<seller suffix>_<name>`.
- Accounts created without inbound tags (which give an empty subscription) are healed on explicit sync.
- Quota `0` in Marzban means unlimited, and `expire` is Unix seconds; the panel stores these as `null` and absolute dates.
- Marzban is the source of truth. The panel's `vpn_users` table is a mirror of it.
- Adding support for another server type: [backends.md](backends.md).
