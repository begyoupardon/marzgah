# Marzgah (مرزگاه)

A reseller panel for [Marzban](https://github.com/Gozargah/Marzban) VPN servers.
Admins manage resellers ("sellers"); sellers manage their own customers; customers get a private page
with their usage, connection QR code and a renewal button.

UI language: Persian (RTL). Stack: TanStack Start (React 19), oRPC, better-auth, drizzle + SQLite, Tailwind/shadcn.
Runs on **Bun + local SQLite** (self-hosted, the default) or **Cloudflare Workers + D1**.

## What it does

| For           | Features                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Admins**    | Create/suspend resellers, per-seller price, user and GB caps, prepaid/postpaid credit model, wallet balance · audit log with before/after · announcements banner · system health · Telegram bot setup                                                                                            |
| **Sellers**   | Create, renew, edit and disable customers · prepaid **wallet** (sales settle from it automatically) · filters (expiring, high usage, unpaid, label) · customer phone/Telegram/labels · CSV import/export · customer page link · renewal-request inbox · Telegram alerts · sales and debt reports |
| **Customers** | `/s/<token>`: usage, days left, QR + subscription link, app downloads, "request renewal" (no login)                                                                                                                                                                                              |

Details: [docs/features.md](docs/features.md).

<!-- release-only-start -->

## npm CLI package

The publishable Bun-based CLI is in `packages/cli`; the website package stays private. Build with `bun run build:cli`, verify the installed tarball with `bun run test:cli-package`, and create it with `bun run pack:cli`. See [npm release instructions](docs/npm-cli.md) for the new repository identity, first publication and GitHub Actions trusted publishing.

After the first npm publication, users can scaffold a complete panel with `bunx @begyoupardon/marzgah init my-panel`. Use `--scaffold-only` to create files without installing dependencies or running the setup wizard. Requires Bun 1.4.4 or newer.
<!-- release-only-end -->

## Quick start

Requires a recent [Bun](https://bun.sh) (developed on 1.4) and a running Marzban.

```bash
bun install
bun run cli init        # interactive wizard
```

The wizard asks where it will run (Docker + Bun, Bun directly, or Cloudflare), your domain, Marzban URL and
credentials (it tests the login), then generates secrets, writes `.env`, applies migrations and creates the
first admin. For Docker it also writes `docker-compose.yml` (with Caddy for automatic HTTPS if you give a domain).
It finishes by printing the two lines to add to Marzban's `.env` for webhooks.

Without Docker:

```bash
bun run build && bun run start      # http://localhost:3000
```

Check your setup any time with `bun run cli doctor`.

## CLI

`bun run cli <command>` (inside Docker: `docker compose run --rm panel bun run cli <command>`).

| Command                                 | What it does                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `init`                                  | Interactive first-time setup (see above)                                                              |
| `migrate`                               | Apply SQLite migrations. Also runs automatically on boot (disable with `AUTO_MIGRATE=false`)          |
| `create-admin --email … --password …`   | Create an admin (password ≥ 12 chars). Prompts when flags are omitted                                 |
| `reset-password --email … --password …` | Set a new password for any user                                                                       |
| `doctor`                                | Checks secrets, database file and VPN-server login; exits non-zero on problems                        |
| `backup [--out file] [--keep N]`        | Consistent online SQLite backup (`VACUUM INTO`); `--keep` rotates                                     |
| `restore <file>`                        | Replace the database from a backup. **Stop the panel first**; the old file is kept as `*.pre-restore` |

## Configuration

Set in `.env` (Bun/Docker) or as Worker secrets (Cloudflare). Parsed and validated by `src/lib/env.ts`; a production
boot **refuses to start** if `BETTER_AUTH_SECRET` is under 32 characters or `BETTER_AUTH_URL` is missing.

| Variable                                                     | Required    | Purpose                                                                                                                          |
| ------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`                                            | yes         | Public URL of the panel (must match what users type; Telegram needs `https://`)                                                  |
| `BETTER_AUTH_SECRET`                                         | yes         | ≥ 32 random chars. Signs sessions **and encrypts stored secrets** (bot token, gateway credentials). Changing it invalidates both |
| `BOOTSTRAP_ADMIN_EMAIL`                                      | first run   | Email allowed to create the first admin from `/login`                                                                            |
| `MARZBAN_BASE_URL` / `MARZBAN_USERNAME` / `MARZBAN_PASSWORD` | yes         | Marzban sudo admin                                                                                                               |
| `MARZBAN_WEBHOOK_SECRET`                                     | recommended | Shared secret for `POST /api/webhooks/marzban`                                                                                   |
| `MARZBAN_SUBSCRIPTION_URL_PREFIX`                            | optional    | Public subscription origin when it differs from the API host                                                                     |
| `DATABASE_PATH`                                              | no          | SQLite file (default `./data/panel.db`; `/data/panel.db` in Docker)                                                              |
| `BACKUP_DIR` / `BACKUP_KEEP`                                 | no          | Where the daily auto-backup goes (`./backups`; `/data/backups` in Docker) and how many to keep (14)                              |
| `SCHEDULER=off`                                              | no          | Disable background jobs (run them on exactly one instance)                                                                       |
| `DB_DRIVER`                                                  | no          | Force `bun-sqlite` or `d1` (normally auto-detected)                                                                              |

Telegram and payment-gateway settings are **not** environment variables: admins enter them in the panel and they are
stored encrypted in the database.

## Development

| Command                               |                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `bun run dev`                         | Dev server on :3000 with local SQLite (`./data/panel.db`)                       |
| `bun run dev:cf`                      | Same, but through the Cloudflare plugin (D1)                                    |
| `bun run build` / `bun run start`     | Production build for Bun, and run it                                            |
| `bun run build:cf` / `bun run deploy` | Cloudflare build / deploy                                                       |
| `bun run test`                        | `bun test --isolate` (the flag matters, see [docs/testing.md](docs/testing.md)) |
| `bun run typecheck`                   | `tsc --noEmit`                                                                  |
| `bun run db:generate`                 | Create a migration from `src/db/schema.ts` changes                              |
| `bun run db:studio`                   | Drizzle Studio                                                                  |

> After clearing `node_modules/.vite`, the first page load in dev can be blank while Vite re-optimizes
> dependencies. Wait a few seconds and reload.

CI (`.github/workflows/ci.yml`) runs typecheck, tests, both builds, a check that the schema matches the committed
migrations, and a Docker build. `bun run lint` currently reports pre-existing errors (≈300); it is not part of CI.

## Project layout

```
src/db/            schema, SQLite/D1 driver selection, migrations (../drizzle)
src/lib/           domain logic: wallet, notifications/, backends/, billing, scheduler, jobs…
src/orpc/router/   API (oRPC procedures); middleware = authentication + roles
src/routes/        pages and HTTP endpoints (TanStack file routes)
src/components/    UI
cli/               the `marzgah` CLI
server/plugins/    boot hook: config check + background jobs
test/              helpers (in-memory DB, factories), fakes, backend contract
docs/              guides (below)
```

## Documentation

- [docs/deploy.md](docs/deploy.md) – Docker, bare Bun, Cloudflare, reverse proxy, backups, upgrades, webhooks
- [docs/features.md](docs/features.md) – how wallet, notifications, the customer page and seller tools work
- [docs/architecture.md](docs/architecture.md) – design decisions and data model
- [docs/backends.md](docs/backends.md) – the `VpnBackend` interface and how to add a server type
- [docs/marzban.md](docs/marzban.md) – Marzban side of the setup
- [docs/testing.md](docs/testing.md) – test strategy, helpers, and the release smoke checklist

## Status and known limits

Built and tested: everything above, with 250+ automated tests against a real in-memory SQLite database.
Not yet verified against live services: your real Marzban, Telegram, and the Zarinpal gateway. Walk through the
checklist in [docs/testing.md](docs/testing.md#release-smoke-checklist) before relying on it.

- Bulk renew and bulk labels exist in the API only (no row-selection UI yet). Impersonation is not implemented.
- Background jobs (sync, backups, Telegram sending) run only on the Bun server, not on Cloudflare.
- Rate limits are in memory (reset on restart, not shared between instances).
- Database columns and the webhook path still say "marzban"; only Marzban is implemented behind the backend interface.
- Notifications cannot be muted per user.
