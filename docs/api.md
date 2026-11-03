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
