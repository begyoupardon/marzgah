# Host management (administrators only)

Open **Administration → Connection access**. The page uses the full available width and separates **Hosts**, **Templates**, **Reseller assignments**, and **Activity**. Resellers cannot see these screens, fields or Telegram commands, and their API keys cannot call any `access.*` operation. Resellers continue creating and managing ordinary VPN accounts; their connection settings come from the administrator's policy.

## Select individual hosts

Every host has its own checkbox, including hosts that share an inbound. Search by remark/address/inbound, filter by protocol, show selected entries, or select/deselect all visible hosts. Changing a filter does not discard selections outside that filter. Disabled or unavailable hosts cannot be newly selected; unavailable saved entries are shown so administrators can remove or replace them.

The **Hosts** tab edits either system defaults for new accounts or **Required for everyone**. Default hosts can use any supported protocol. Existing installations retain their former VLESS default until an administrator saves an explicit host default.

A selection identifies backend, protocol, inbound tag and stable host IDs. IDs are derived from host definitions and survive host-list reordering. Endpoint/remark changes require explicit reselection instead of silently selecting a different host.

## Templates and reseller assignments

Create a template, name it, and select its hosts. Use **Assign to resellers** to select one or multiple resellers and assign that template. You can also choose **Select hosts** beside a reseller to create a custom host selection.

A new reseller assignment applies to **all of that reseller's existing nonarchived users and future users**, including replacing earlier per-user selections. Review the affected users before confirming. It preserves account status, usage, quota, expiry and billing.

Template users stay linked: subsequent template edits propagate to those linked accounts. An administrator can override an individual user afterward in the user's Connection access tab; that override survives ordinary template edits, until an administrator explicitly reassigns the reseller again. Referenced templates cannot be deleted; reassign their users/resellers first.

The reseller sees normal account controls and a subscription link, without template names, selection controls, policy details, or application-operation history.

## Subscription contents and connection access

Individual host selection controls **which configs appear in the subscription**. Marzban still authorizes users at the parent-inbound level. Hosts sharing that inbound may share credentials; this feature does not prevent someone who already possesses a sibling config from using it. Separate inbounds are needed for that kind of connection isolation.

When an account has individual host restrictions, Marzgah returns a signed panel subscription link such as `/subscription/<account-id>/<signature>` through the user API, share/QR UI, Telegram and customer page. The underlying Marzban URL stays internal. The signature is bound to the account and upstream subscription credential; revoked credentials invalidate old panel links, including before the local mirror catches up.

**Existing users must import the new panel subscription link in their VPN client.** An old direct Marzban URL cannot be filtered by Marzgah. Changing a policy automatically affects subsequent refreshes of the managed panel link. The panel does not automatically rotate everyone's subscription credentials.

Managed subscriptions support base64 V2Ray share links, Clash/Clash Meta YAML, sing-box JSON, V2Ray JSON, and Outline JSON. Common client user agents choose a format automatically; `?format=v2ray|clash|clash-meta|sing-box|v2ray-json|outline` selects it explicitly. Selection is applied before sending configs; proxy-group/selector references are also cleaned up.

Use a distinct remark or endpoint for hosts that otherwise generate indistinguishable configs. Ambiguous definitions, unsupported structures, a missing host catalog, or unavailable selected configs return a retryable failure rather than falling back to an unfiltered subscription. Responses are uncached, and unsupported/removed accounts and invalid/revoked signatures return a uniform not-found response.

## Required for everyone

Selected required hosts are added to every nonarchived locally known user and to future users. This does not import orphan users that exist only in Marzban. Other independent selections remain in effect; removing a requirement does not remove an independently selected host. Empty effective access is rejected. Disable an account separately to suspend service.

Legacy inbound-level selections still mean all hosts under that inbound. Select individual hosts or assign a host template to replace that legacy selection with a precise set.

## Preview, application, and recovery

Changes remain local drafts until **Review and save → Confirm and apply**. Preview examples are bounded at 200 while affected counts include every user. The Activity tab shows persisted operations with paginated per-user results, pending/applied/failed/skipped status, and retry controls.

The Bun scheduler drains bounded batches every 15 seconds. Database-backed leases serialize application per account across workers; timeouts are inspected before retrying. Marzban webhooks and periodic sync enqueue reconciliation. Ordinary reads never broaden access. Managed users' external inbound edits are restored to their administrator-defined policy.

Cloudflare needs external authenticated `access.drain` calls because the Bun scheduler does not run there. All instances serving panel links must share the database and `BETTER_AUTH_SECRET`; the panel must be reachable by customers' VPN clients.

## Upgrade and validation

CLI **0.7.0** includes migrations through `0021_reseller_host_assignments.sql`, which records reseller-assignment adoption separately from per-user overrides. Existing data and legacy selections are preserved. See [release and Bun/systemd upgrade steps](npm-cli.md).

After upgrading, check `bun run cli doctor`, create one host template, assign it to a test reseller, and inspect the resulting managed subscription. Confirm a sibling host on the same inbound is absent. Reimport that panel link in a disposable VPN client before rolling out broadly. Verify disabled accounts stay disabled and the worker clears pending tasks.
