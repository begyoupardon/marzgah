# API for agents and scripts

Marzgah serves the same oRPC operations used by its panel as JSON HTTP endpoints. The machine-readable contract is at `/api/spec.json`; the interactive reference is at `/api/`. Both are public. Calling account operations requires a key. Use HTTPS in production.

## Create a key

Sign in to the panel and open **API keys**. Give each agent or tool a separate name and choose a 30, 90, or 365 day expiry (default: 90 days). Copy the key when it appears: it is never shown again. You can see when it was last used and revoke it immediately from the same page. To rotate, create a replacement, update your agent, then revoke the old key.

An API key acts as its owner with the owner's **current** role and reseller scope. Admin keys can perform admin actions, including sensitive integration settings. Reseller keys cannot see or change another reseller's records. Demoting or deleting an account changes or removes its key access on the next call. Key management itself requires a browser session; keys cannot create other keys.

## Call the API

All current operations use `POST` with a JSON body. The paths and schemas are in the OpenAPI document. Use an empty object for an operation with no inputs. The examples read the key into a shell variable so its literal value is not saved in shell history:

```bash
read -r -s MARZGAH_API_KEY
export MARZGAH_API_KEY
export MARZGAH_URL='https://panel.example.com'

curl --fail-with-body -sS "$MARZGAH_URL/api/me" \
  -H "Authorization: Bearer $MARZGAH_API_KEY" \
  -H 'Content-Type: application/json' -d '{}'

curl --fail-with-body -sS "$MARZGAH_URL/api/vpnUsers/list" \
  -H "Authorization: Bearer $MARZGAH_API_KEY" \
  -H 'Content-Type: application/json' -d '{"page":1,"pageSize":20}'

curl --fail-with-body -sS "$MARZGAH_URL/api/vpnUsers/create" \
  -H "Authorization: Bearer $MARZGAH_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"username":"customer1","dataLimitBytes":10737418240,"durationDays":30}'
```

For an admin, `vpnUsers.create` also needs `resellerId`. VPN limits use **bytes** and have a minimum of **0.1 GB** (`107374182` bytes); billing and wallets use **toman**, and expiry uses the operation's documented day or month fields. `vpnUsers.list` starts at page 1 and accepts page sizes 10, 20, or 50. Use `page` until the returned list reaches its reported total. Other list operations document their own paging fields.

Download the current contract before generating client code:

```bash
curl --fail-with-body -sS "$MARZGAH_URL/api/spec.json" -o marzgah-openapi.json
```

The two `public.*` customer-link operations are intentionally unauthenticated and require their own customer link token. Browser sign-in, session management, and API key management are not part of the external API.

## Errors and safe use

The API returns JSON errors with an HTTP status and oRPC error code. `401` means the bearer key is missing, invalid, revoked, or expired; `403` means the authenticated account lacks permission; `404` can mean a resource is outside the reseller's scope; `400` indicates invalid input. Treat money and remote VPN mutations as potentially successful if a connection fails after sending a request: inspect current state before retrying. Use the documented idempotent operations where available.

Store the key in a secret manager or protected environment variable. The example's expanded `Authorization` header may be visible to local processes while curl runs; use a protected curl config or agent secret provider when that matters. Never place the key in a URL, repository, chat message, log, or screenshot. Revoke a suspected compromised key and create a replacement. API requests and audit records identify the account and key ID, never the secret value.

## Connection access (admin-only)

Every `access.*` operation requires the caller's current administrator role. Reseller sessions, API keys and Telegram actors receive `403`, including for catalog, user access and operation-status reads. Ordinary reseller account creation must omit both `access` and `proxies`; administrator policies supply the connection settings.

| Procedure                         | Purpose                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `catalog`                         | Host catalog, stable host IDs, protocols, inbound context, templates and policy revision |
| `user`                            | Desired/effective/observed selection for `{username}`                                    |
| `assign`                          | `{username, selection, revision, policyRevision, idempotencyKey}` → `{operationId}`      |
| `policy`, `preview`, `savePolicy` | Read, preview and atomically save administrator policy                                   |
| `operations`, `operation`         | Recent operations and paginated per-user results                                         |
| `retry`, `drain`                  | Retry failures or process a bounded batch                                                |

An inbound reference is `{ "protocol":"vless", "tag":"VLESS TCP", "hostIds":["<host ID returned by catalog>"] }`. Omitting `hostIds` retains the legacy meaning of every host under that inbound; host arrays must be nonempty. Host IDs are stable across catalog reordering, and unknown/disabled IDs are rejected. Selections remain `{ "mode":"custom", "inbounds":[...] }` or `{ "mode":"template", "templateId":"stable-id" }`.

A policy contains `required`, `approved`, `templates` and `resellers`, with optional `hostDefaults:true` to apply approved hosts across all selected protocols rather than the legacy VLESS default. A reseller entry contains `resellerId`, `allowed`, `defaultTemplateId` and optional UUID `assignmentId`. Generate a new assignment ID when explicitly assigning/reassigning a reseller: this updates all existing users to the new selection. Keeping that ID while editing a template preserves later per-user overrides. The web panel manages these IDs automatically.

Use current revisions and a UUID idempotency key for each logical write. Reuse the same key and exact payload after a lost response; a stale edit returns `409`. Saving returns an operation ID, not proof of upstream completion. Inspect `pending` and `failed`. Results default to 50 rows (`offset`, `limit`, maximum 100), with global aggregate counts. Previews show at most 200 examples and expose `truncated`.

User create/update/list/renew/sync outputs and customer/Telegram sharing return a signed panel subscription URL when host filtering is required. Clients must import that new link to receive filtered configs; direct upstream URLs previously distributed cannot be filtered. Signed endpoints need no session, verify revocation against the backend, and serve only the current selection. See [host management](connection-access.md) for format support, inheritance, failure behavior and rollout.
