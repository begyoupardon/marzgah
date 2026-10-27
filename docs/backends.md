# VPN backends

The panel talks to the VPN server only through the `VpnBackend` interface in
[`src/lib/backends/types.ts`](../src/lib/backends/types.ts). Marzban is the one
shipped adapter; the rest of the app (routers, sync, suspension, health) never
imports Marzban code directly.

## What the interface looks like

Users are neutral objects: bytes, `Date`s, `null` for "unlimited / never".
Adapters translate to and from their server's own shapes (Marzban uses unix
seconds, `0` for unlimited, `inbounds` tags, `proxies`, …) and turn failures
into `BackendError` with one of `NOT_FOUND | CONFLICT | INVALID | UNSUPPORTED | UNAVAILABLE`.

Backend-specific behaviour stays inside the adapter, for example:

- **Inbound repair** (Marzban): `getUser` heals accounts created without
  inbound tags unless called with `{ repair: false }`.
- **Passwords**: `updateUser({ password })` throws `UNSUPPORTED` when the
  account has no password-based protocol.

## Which backend a user lives on

`vpn_users.backend` stores the **registry key** (default `marzban`). Every
operation resolves it with `getBackend(row.backend)`. New users go to
`DEFAULT_BACKEND_ID`. An unknown key throws instead of falling back, so a typo
can never send commands to the wrong server.

## Adding a backend

1. Implement `VpnBackend` in `src/lib/backends/<name>.ts`.
2. Register it in `src/lib/backends/registry.ts` (`factories`).
3. Add a contract test next to the existing one in
   `src/lib/backends/backend.contract.test.ts`:

   ```ts
   backendContract('My adapter', () => ({
     backend: createMyBackend(),
     addUsage: (username, bytes) =>
       myServerSimulation.addUsage(username, bytes),
   }))
   ```

   The contract ([`test/contract/backend.ts`](../test/contract/backend.ts))
   covers create/read round-trips, partial updates, usage reset, subscription
   revocation, deletion, paging and error codes. Passing it is what makes an
   adapter interchangeable. The Marzban adapter is tested against an emulated
   Marzban HTTP server (`test/fakes/marzban-server.ts`).

4. Add the adapter's environment variables to `src/lib/env.ts` and the CLI
   `init` wizard.

## Testing the rest of the app

Install the in-memory `FakeBackend` for the whole router stack, no HTTP mocks:

```ts
import { FakeBackend } from '../../../test/fakes/backend'
import { setBackend } from '#/lib/backends/registry'

const fake = new FakeBackend()
setBackend('marzban', fake) // routers now use it
```

## Known limits

- Column and webhook names still say "marzban" (`marzban_username`,
  `/api/webhooks/marzban`); renaming them is a separate migration.
- Only Marzban sends webhooks today. Other backends rely on the periodic sync.
- `getBackend()` for _new_ users always uses the default backend; choosing a
  backend per reseller is not implemented.
