# Architecture

## Shape of the app

```
browser ──► TanStack Start (SSR + routes)
              ├─ /api/rpc/*   oRPC router  (src/orpc/router)   ← all UI data
              ├─ /api/auth/*  better-auth
              ├─ /api/webhooks/marzban, /api/telegram/webhook
              └─ /s/:token    public customer page
                    │
        src/lib/*  (domain logic, no HTTP)
                    │
        drizzle ──► SQLite (bun:sqlite)  or  Cloudflare D1
        VpnBackend ──► Marzban (HTTP)
```

- **Routers are thin.** They authenticate, check ownership, call `src/lib`, and write the audit log. Business rules
  (wallet, outbox, tokens, filters, suspension) live in `src/lib` and take the database as a parameter, so
  tests run them against an in-memory SQLite with the real migrations.
- **Authorization** is in `src/orpc/middleware.ts`: `base` (public), `authed`, `adminOnly`. Roles are re-read from the
  database on every call. Sellers are scoped by `resellerId` in every query; other sellers' rows answer "not found".
- **One process** serves the app and runs the background jobs (`server/plugins/boot.ts` → `src/lib/jobs.ts`).

## Database

SQLite through drizzle. The driver is chosen at runtime (`src/db/index.ts`): `bun:sqlite` in the Bun server, D1 on Workers.
Both speak the same SQL, so migrations in `drizzle/` are shared. SQLite runs in WAL mode with a busy timeout.
Because D1 has no interactive transactions, anything that must be atomic is written as **one statement** (see wallet).

Schema changes: edit `src/db/schema.ts` → `bun run db:generate` → commit the SQL and snapshot. CI fails if the schema and
migrations disagree. Migrations only move forward.

| Area          | Tables                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Auth          | `user` (with `role`), `session`, `account`, `verification`                                                                  |
| Sellers       | `reseller_profiles` (suffix, price/GB, caps, credit limit, branding)                                                        |
| VPN users     | `vpn_users` (local mirror of the server's state, plus contact fields, labels, `backend`, `suspended_at`, soft `removed_at`) |
| Money         | `billing_events` (what was sold), `wallet_entries` (append-only ledger)                                                     |
| Messaging     | `telegram_links`, `telegram_link_codes`, `notifications` (outbox)                                                           |
| Customer page | `subscription_tokens` (hash only), `renewal_requests`                                                                       |
| Ops           | `audit_logs`, `webhook_events`, `settings` (encrypted JSON)                                                                 |

`vpn_users` is a **mirror**: the VPN server is the source of truth. It is refreshed on every list view (rows younger than
30 s are reused), by webhooks, and by a 10-minute background sync.

## Money

- `wallet_entries` is **append-only**. Balance = Σ credits − Σ debits. Nothing is ever updated or deleted.
- `UNIQUE(provider, reference)` makes every movement idempotent: a payment id, a billing-event id or a request id is the
  reference. Retrying, replaying a callback, or double-clicking is a no-op.
- A debit is a single `INSERT … SELECT … WHERE balance − amount ≥ −overdraft`, so concurrent debits cannot overdraw.
- Settling a sale from the wallet = debit (reference = billing event id) then mark the event settled. A crash between the
  two is repaired by retrying, because the debit is idempotent.
- Crediting a top-up happens **before** its status flips to approved/paid, for the same reason.
- `billing_events` stays the record of what was sold and who owes what; the wallet only moves money between "owed" and "paid".

## Background jobs (`src/lib/scheduler.ts`, `src/lib/jobs.ts`)

A minimal in-process scheduler: a job never overlaps itself, one job's failure doesn't stop the others, and failures are
written to the audit log (`job.failed`).

| Job                   | Interval | Does                                         |
| --------------------- | -------- | -------------------------------------------- |
| `sync-users`          | 10 min   | Refresh mirrors from Marzban                 |
| `auto-backup`         | 24 h     | `VACUUM INTO` backup + rotation              |
| `scan-notifications`  | 1 h      | Queue expiry / traffic / low-wallet messages |
| `drain-notifications` | 1 min    | Send due messages                            |

Skipped on Cloudflare and when `SCHEDULER=off`. Run exactly one instance with jobs enabled.

## Notifications: transactional outbox

Producers only **insert** rows into `notifications` with a `dedupe_key` (re-running a scan is safe). A separate drain job
claims due rows with a compare-and-set lease on `next_attempt_at`, sends, and records the outcome. Consequences: sending
never blocks or fails a business action, two workers can't send the same row, a crashed worker's rows reappear when the
lease expires, and failures back off instead of hammering Telegram. Delivery goes through the `Notifier` port
(`src/lib/notifications/types.ts`); Telegram is the only implementation.

## VPN backends

`VpnBackend` (`src/lib/backends`) hides the VPN server. See [backends.md](backends.md). Rule of thumb: if code outside
`src/lib/backends/marzban.ts` and `src/lib/marzban/*` needs Marzban's shape (unix-second expiry, `proxies`, `inbounds`),
the interface is missing something, add it there.

## Security decisions

- **Customer links** are 192-bit random tokens; only the SHA-256 hash is stored, so a database leak does not leak links.
  Lookup is by exact hash, not by scanning. All failure modes return the same response.
- **Link codes** for Telegram: 8 characters, hashed, 15 minutes, single use, one active per user.
- **Webhook secrets** (Marzban, Telegram) are compared in constant time; the Telegram webhook requires its secret header, and gateway callbacks are verified with the gateway itself.
- **Secrets at rest** (`settings.encrypted = true`): AES-GCM with a key derived (HKDF) from `BETTER_AUTH_SECRET`.
- **CSV** output neutralizes spreadsheet formulas; messages to Telegram are plain text.
- **Rate limits:** sign-in (better-auth, per IP), customer page and renewal requests (in memory, `src/lib/rate-limit.ts`).
- **Audit:** most state-changing admin and seller actions write `audit_logs` (user changes include before/after values). Plan edits and some read-adjacent actions are not audited yet.

## Known trade-offs

- A VPN-server change and the matching database write cannot share a transaction. Operations are ordered so a failure
  leaves a recoverable state (claim → act → undo on failure for renewal requests), but a
  crash after a remote change can leave the mirror briefly stale until the next sync.
- In-memory rate limits reset on restart and are per instance.
- `backend`/`marzban_username`/webhook naming still reflects Marzban being the only implementation.
