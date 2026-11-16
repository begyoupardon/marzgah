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

## Connection access

The `access` namespace uses the same `POST /api/access/<procedure>` convention and current-role bearer authentication:

| Procedure    | Permission     | Purpose                                                                                                                                              |
| ------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog`    | Authenticated  | Available inbounds, associated hosts, permitted templates, defaults and requirements; optional `backend` and admin-only effective `resellerId` scope |
| `user`       | Owner or admin | `{username}` → desired source, effective/observed access, assignment `revision`, `policyRevision`, locked grants and pending/error state             |
| `assign`     | Owner or admin | `{username, selection, revision, policyRevision, idempotencyKey}` → `{operationId}`                                                                  |
| `policy`     | Admin          | Versioned policy containing `required`, `approved`, `templates`, and `resellers`                                                                     |
| `preview`    | Admin          | `{backend, policy}` → affected users and changes; does not change desired policy or remote access                                                    |
| `savePolicy` | Admin          | `{backend, policy, revision, idempotencyKey}` → `{operationId}`                                                                                      |
| `operations` | Authenticated  | Recent accessible operations                                                                                                                         |
| `operation`  | Actor or admin | `{id, offset?, limit?}` → paginated per-user results and aggregate progress                                                                          |
| `retry`      | Actor or admin | `{id}` → requeue failed rows                                                                                                                         |
| `drain`      | Admin          | `{limit:20}` → process at most 50 tasks; intended for external scheduling and manual recovery                                                        |

An inbound reference is `{ "protocol": "vless", "tag": "VLESS TCP" }`; the backend is specified separately and defaults to `marzban`. Selection is either `{ "mode": "template", "templateId": "stable-id" }` or `{ "mode": "custom", "inbounds": [...] }`. `vpnUsers.create` accepts the same selection in its optional `access` field. Omitting it uses the reseller default, including during CSV import and Telegram creation.

Fetch current revisions before editing. Policy revisions also advance when assignments are enrolled or edited so previews cannot silently overwrite concurrent access changes. On `409 CONFLICT`, refresh and review again. Use a UUID `idempotencyKey` for each logical mutation and reuse it when retrying the exact request after a lost response; reusing it with a different payload is rejected. Inspect the returned operation until `pending` reaches zero; check `failed` and each task's error before considering the application complete. Older queued operations resolve the latest desired selection rather than restoring outdated policy.

Operation results default to 50 rows and accept `offset` plus `limit` (maximum 100); aggregate counts cover the entire operation. Preview responses contain at most 200 change examples, a full `affected` count, and a `truncated` flag.

A policy document has this shape:

```json
{
  "required": [],
  "approved": [{ "protocol": "vless", "tag": "VLESS TCP" }],
  "templates": [
    {
      "id": "standard",
      "name": "Standard",
      "inbounds": [{ "protocol": "vless", "tag": "VLESS TCP" }]
    }
  ],
  "resellers": [
    {
      "resellerId": "account-id",
      "allowed": [{ "protocol": "vless", "tag": "VLESS TCP" }],
      "defaultTemplateId": "standard"
    }
  ]
}
```

Templates are shared and linked, not Marzban's native user templates. Updating the full document requires its current revision; unknown fields, duplicate template/reseller IDs, missing defaults, unavailable inbounds and empty effective access are rejected. See [connection access](connection-access.md) for inheritance, rollout and global requirements.
