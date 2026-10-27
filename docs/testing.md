# Testing and verification

```bash
bun install --frozen-lockfile
bun run test         # bun test --isolate
bun run typecheck
bun run build && bun run build:cf
bunx drizzle-kit generate --name check   # must say "No schema changes"; delete the file if it creates one
```

CI runs all of these plus a Docker build. Use one package manager: mixed pnpm/Bun `node_modules` once resolved two
incompatible TanStack router-core copies (versions are pinned with `overrides`).

## Why `--isolate`

`bun:test` runs every test file in one process and `mock.module` is global, so one file's mocks leak into the next.
`--isolate` gives each file a fresh global. Always use `bun run test`, not a bare `bun test`.

## How tests are written

Most tests run **real code against a real in-memory SQLite** with the real migrations applied, not against mocks of query
builders.

| Helper                                                                                | Use                                                                                                                     |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `test/helpers/db.ts` → `createTestDb()` / `mockDb()`                                  | Fresh migrated database; `mockDb()` also points `#/db` at it                                                            |
| `test/helpers/factories.ts`                                                           | `makeUser`, `makeReseller`, `makeVpnUser`                                                                               |
| `test/helpers/orpc.ts` → `setupRouterTest()`, `callAs(proc, input, userId, headers?)` | Calls a router procedure in-process with the **real** auth middleware; only the session lookup is faked (`x-test-user`) |
| `test/fakes/backend.ts`                                                               | `FakeBackend`: in-memory VPN server that records calls                                                                  |
| `test/fakes/marzban-server.ts`                                                        | Emulated Marzban HTTP API (for the real client + adapter)                                                               |
| `test/contract/backend.ts`                                                            | `backendContract(name, factory)`: behaviour every backend must share                                                    |
| `test/helpers/hoisted.ts`                                                             | Compatibility shim for the older vitest-style tests (`vi`, `hoisted`)                                                   |

Conventions:

- Files named `*.db.test.ts` use the real database. Older `*.test.ts` files that mock `#/db` remain valid.
- Mock a module (`mock.module`) **before** the dynamic `await import()` of the code that uses it.
- Idempotency keys are unique per database, so tests that reuse a reference need distinct ones.
- Router tests that touch Marzban install `FakeBackend` (`setBackend('marzban', fake)`) or mock `#/lib/marzban/client`.
- `test/setup.ts` (via `bunfig.toml`) forces `DATABASE_PATH=:memory:` so tests never touch `./data`.

## What is covered

- **Money:** wallet balance, idempotent credit/debit, concurrent debits cannot overdraw, bounded overdraft, settling from
  the wallet (and recovery after a crash between debit and settle), credit limits, billing summaries.
- **Authorization:** per router, "seller A cannot read/act on seller B", admin-only procedures, unauthenticated calls,
  secrets never returned to the UI.
- **Seller tools:** limits, filters, labels, CSV round-trip and formula neutralizing, CSV import row handling, bulk
  results, suspend/resume with partial failure.
- **Customer page:** token hashing, revoke/replace/expire, uniform not-found, no data leaks, rate limits, renewal
  request lifecycle including approval failure recovery.
- **Notifications:** outbox dedupe, lease (two workers), backoff, retry-after, dead-letter, blocked-chat unlink,
  link codes (single use, expiry, hashed), bot webhook secret, event producers.
- **Backends:** the contract suite on `FakeBackend` and on the Marzban adapter (via the emulated server), adapter
  specifics (inbound repair, passwords, error codes), and the whole router stack on `FakeBackend`.
- **Platform:** env validation, scheduler (no overlap, failure isolation), backups and rotation, migration/journal
  consistency, CLI round-trip (migrate → create-admin → backup → restore), login rate limit, webhook lease.
- **Older coverage kept:** Marzban token caching and 401 retry, traffic/expiry mapping, zero-quota-means-unlimited,
  404 soft removal, webhook validation and retries, credential creation, real better-auth password verification and
  secure cookies, stale-admin-role override, renewals using live quota.

**Not covered by automated tests:** the UI (no component or browser tests), real Marzban, real Telegram, real Zarinpal,
the Docker image build (CI builds it), and Cloudflare runtime behaviour (CI only builds it).

## Findings addressed over time

- User lists used to read a stale mirror. Visible users now refresh from the VPN server (rows younger than 30 s reused),
  with a stale-data warning on upstream errors and bounded concurrency.
- List refreshes don't modify remote accounts; an explicit sync may repair missing inbound tags. No ownership is
  inferred from remote users.
- Zero quota means unlimited; expiry is absolute; the list shows remaining bytes and days.
- Webhook failures return 503 so Marzban retries; storage outages are not mistaken for duplicates; concurrent duplicate
  deliveries of one event are now processed once (lease), which also stops duplicate audit rows.
- Renewals and extra-traffic billing read current remote expiry/quota; renewal validates quota before resetting usage.
- Credential creation writes the user and account together (single transaction; on D1 via batch).
- The database role overrides a stale session role after demotion.
- `LIKE` searches define their escape character so `_` in usernames matches literally.
- Example env files hold placeholders only. **Values committed earlier remain in git history; rotate them if they
  were ever used.**

## Limits

- `BETTER_AUTH_URL` must match the production domain. For several domains, configure explicit trusted origins; do not
  disable origin checks.
- Dashboard totals come from mirrors, kept fresh by the 10-minute sync and webhooks; they are not a live query.
- Marzban "on hold" activation durations are not modelled; remaining days reflects absolute `expire` only.
- A VPN-server change and the database write cannot share a transaction. Operations are ordered to be recoverable
  (see [architecture](architecture.md#known-trade-offs)), but a crash mid-operation can leave a mirror stale until the
  next sync.
- `bun run lint` still reports pre-existing errors (about 300: unsafe index typing assumptions and generated/UI import
  style). It is not part of CI. Test, typecheck and build are independent checks; don't describe lint as passing.

## Release smoke checklist

Use disposable accounts and a staging VPN server for anything that mutates.

1. Sign in, reload an authenticated page, sign out. Try 6 wrong passwords: the 6th is refused.
2. `bun run cli doctor` is green. Create a seller; confirm they see only their own data.
3. Create, edit, renew, reset usage, revoke link, disable a customer; compare usage and expiry with Marzban.
4. Top-up: request → approve (card) → balance credited → next sale settles from the wallet. Try the Zarinpal sandbox.
5. Set a credit limit and confirm a sale past it is refused before anything is created on Marzban.
6. Suspend a seller: their users are disabled on Marzban; resume: only those users come back.
7. Customer page: open `/s/<token>` logged out on a phone; QR and copy work; revoke it and confirm "not valid";
   request a renewal and approve it.
8. Telegram: register the webhook, link a chat, send the test message, trigger an expiry warning.
9. Webhooks: stop Marzban reachability briefly and confirm a retry succeeds without duplicate audit entries.
10. `bun run cli backup`, then restore into a scratch copy and open it.
11. Mobile layout of the users list and the customer page.
