# Connection access

Open **Administration → Connection access** to manage inbound access. Selecting an inbound includes every host attached to it. Host details are descriptive; Marzgah does not rewrite Marzban hosts or filter individual hosts sharing an inbound. If Marzban denies host discovery, inbound selection still works.

## User selections and templates

User creation offers the reseller default, a shared linked template, or a custom selection. The user-management sheet has a separate **Connection access** tab and save action. This action changes connection access only; it does not renew the account, change quota, reset usage, charge money, reactivate disabled users, or replace subscription tokens.

Administrators create shared templates. A linked user's effective access follows subsequent template changes. Switching to custom copies the current editable selection and stops following the template. A referenced template cannot be deleted; reassign users and reseller defaults first. Renaming a template keeps its stable ID and links.

Every effective selection must contain at least one inbound. To suspend service, disable the account separately. Inbound identity includes backend, protocol, and tag; renaming/removing an inbound makes the old selection unavailable. Fix affected policies explicitly rather than relying on automatic expansion.

## Reseller policies

At first catalog initialization, currently available inbounds become the initial approved catalog. Later additions require administrator approval. A reseller inherits that approved set unless an administrator sets a specific allowlist. Each reseller can have a default linked template.

Resellers can edit their own users within their allowlists. Existing access outside an allowlist is shown as admin-controlled and cannot be added or removed by the reseller. Administrator assignments can grant access beyond the reseller allowlist. Reseller-controlled template assignments stay linked when an allowlist narrows; effective access is filtered by the allowlist. A policy change that would leave a managed user with no effective access is rejected.

Without an explicit selection, creation uses the reseller's default template, or all approved VLESS inbounds within their allowlist. Legacy API clients supplying `proxies` without an access selection use those protocol names for the fallback. Global requirements are then added. If no permitted connection remains, creation fails before contacting the user-creation endpoint or charging money.

## Required for everyone

Select **Required for everyone**, preview, and confirm. Required inbounds are added to every nonarchived VPN user known to Marzgah and every future user, including accounts currently disabled, expired, limited, or on hold. They are explicit administrator grants outside reseller allowlists and appear checked and locked in user editors.

This does not import or change orphan users that exist only in Marzban. Existing unmanaged users enter access management when first processed; Marzgah captures their current remote selection before adding requirements. Other choices and account status are preserved. A preview marks these users as retaining current access; their full before/after selection is captured by the worker.

Removing a requirement removes only its global contribution. An inbound independently selected in a custom selection or template remains selected. Removal is rejected if it would leave a managed user without access.

## Application, failures, and external changes

Saving persists an operation and user tasks atomically with the desired change. The UI shows pending, applied, failed, and skipped rows with paginated per-user results. Preview examples are capped at 200 while affected counts include every user. You can leave the page and reopen recent operations. Pending means saved, not yet confirmed on the VPN server. **Process a batch** lets administrators drain up to 20 pending tasks manually; **Retry failed users** requeues failed tasks.

The Bun scheduler processes batches every 15 seconds. Each account has a database-backed lease shared across workers. Transient errors retry with exponential backoff, up to five attempts; invalid/unavailable selections need operator correction. After a timeout, the worker inspects observed access and avoids repeating an already successful mutation. Tasks always resolve the newest desired state, including when several operations overlap.

Marzban webhooks refresh the local mirror and enqueue reconciliation. Periodic user synchronization also queues managed users to catch missed webhooks. Managed users' external inbound edits are corrected to match their current policy; untouched legacy users remain unmanaged. Read-only lists and access inspectors do not apply access changes. Existing automatic repair is disabled for managed users.

Application updates protocol assignments explicitly, preserves existing protocol credentials, and generates settings only for newly introduced protocols. Expired leases recover after a restart. Failed applications remain visible and do not roll back successful users in the same operation.

Cloudflare does not run the Bun scheduler. Configure an external scheduler to call the authenticated `access.drain` operation regularly, or use the admin batch button. See [deployment](deploy.md). Keep periodic user synchronization configured to detect missed webhooks.

## API and Telegram

See [API](api.md#connection-access) for endpoints and revision/idempotency rules. The same authorization and domain services back UI, bearer-key calls, and Telegram.

Telegram's user card includes **Connection access**. `/access username` opens a paginated inbound/template picker; toggle entries, choose **Done**, then confirm. Administrators also have `/access_required`, `/access_template [template-id]`, and `/access_reseller [reseller-id]`. Policy confirmations include the affected user count. `/access_status operation-id [page]` shows progress; `/access_retry operation-id` retries failures after confirmation. Template deletion is available through the panel or policy API.

## Upgrade and verification

Migrations `0019_connection_access.sql` and `0020_protected_access_grants.sql` add versioned access policy, assignment, operation, task, and lease tables without changing existing VPN rows or billing history. Existing users remain untouched until explicitly managed or included by a global requirement. New users receive explicit access assignments.

Back up before upgrading. Apply the normal migrations, verify the scheduler, create a disposable linked user, change its template, then enable an inbound globally and check operation results. Confirm disabled accounts remain disabled. Removing a requirement should preserve independently selected access.
