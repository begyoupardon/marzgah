# Feature guide

Roles: **admin** (runs the panel) and **reseller / seller** (sells to customers). Customers have no account; they use a
private link. Admins see all data; sellers only ever see their own, enforced on the server for every request.

## Users, billing and the wallet

**Selling.** A seller creates a customer (name is prefixed with the seller's suffix: `<suffix>_<name>`), renews it,
adds traffic, or disables it. Each paid action writes a **billing event**: `GB × the seller's price per GB`. Only admins
can remove a user (a soft removal; billing history is never deleted).

**Two ways a seller pays the admin**

1. **Prepaid wallet (recommended).** The seller tops up; every sale is paid from the balance automatically and the
   event is marked settled. If the balance is too low the event simply stays _outstanding_ (a debt).
2. **Post-paid (legacy, default for existing sellers).** Sales accumulate as debt; the seller can mark "I paid" and the
   admin confirms on **تسویه و بدهی**.

**Credit limit.** Admin → **پرداخت‌ها** → wallet: a limit caps how far a seller can go into debt
(`balance − outstanding ≥ −limit`). A sale that would exceed it is refused _before_ anything is created on the VPN
server. No limit set = unlimited debt (the old behaviour), so nothing changes until an admin sets one.

**Money rules** (see [architecture](architecture.md#money)): the wallet is an append-only ledger, balance is the sum
of entries, every credit/debit carries a unique reference so retries and duplicate callbacks cannot apply twice, and a
debit can never overdraw (checked atomically in one statement).

**Caps.** Per seller: maximum number of users and maximum total GB (Admin → نمایندگان → سقف‌ها و تعلیق). Removed users
don't count.

**Suspend / resume.** Suspending disables the seller and every currently active user on the VPN server. Resuming
re-enables **only** the users the suspension disabled, never ones the seller turned off themselves. If the VPN server
fails part-way, the failures are listed; retrying processes only the remaining users.

## Financial Models & Settlement

Admins configure each reseller under **مدیریت نمایندگان**:

- **Postpaid (پس‌پرداخت):** Resellers can create VPN accounts and add traffic without initial wallet balance. Sales are recorded as outstanding debt in **تسویه و بدهی** (`/sales`). Resellers submit a payment claim when paid, and admins review and settle it.
- **Prepaid (پیش‌پرداخت):** Resellers must have available wallet balance (or credit buffer). Admin manages their balance directly or sets an initial deposit upon creation.
- When an account with wallet balance adds or renews a VPN user, sales are automatically settled from the available balance.

## Seller tools

On **کاربران VPN**:

- **Views:** all · expiring within 7 days · over 90% used · unpaid (has an unsettled sale), plus a label filter. Search
  also matches phone and Telegram.
- **Customer details:** phone, Telegram handle and labels (the contact button on each row). Telegram handles link to `t.me`.
  Every change is audited with before/after values.
- **CSV export:** your users (respecting the current view). Cells starting with `= + - @` are prefixed with `'` so a
  spreadsheet cannot run them as formulas.
- **CSV import:** up to 200 rows / 200 KB per file. Header row required.

  | Column                      | Required | Notes                                            |
  | --------------------------- | -------- | ------------------------------------------------ |
  | `username`                  | yes      | Local name (the suffix is added)                 |
  | `gb`                        | yes      | Whole number ≥ 10                                |
  | `months`                    | no       | 0–3, default 1 (0 = no expiry, needs permission) |
  | `note`, `phone`, `telegram` | no       |                                                  |
  | `labels`                    | no       | Separated by `                                   | `   |

  Each row is processed separately, so a bad row doesn't stop the rest, and each respects your caps and wallet. The
  result lists every row's outcome.

- **Bulk renew / bulk labels:** available through the API (`tools.bulkRenew`, `tools.bulkLabel`; up to 50 / 200 users,
  per-user results). There is no selection UI yet.

The dashboard shows a **needs follow-up** card (expiring, high usage, unpaid counts and the soonest expiries with
contact details).

## Customer page

Seller → the contact button on a customer row → **ساخت لینک**. The customer opens `https://<panel>/s/<token>` with no login and sees
usage, remaining days, the subscription link with a QR code, app download links, the seller's name and support contact,
and a **renewal request** form (1–3 months, optional message).

- **The link is shown once.** Only a hash is stored. Making a new link replaces the old one; **لغو لینک** revokes it.
  (An expiry in days can be set through the API; the UI creates non-expiring links.)
- Every kind of bad link (wrong, revoked, expired, user removed) shows the same "not valid" message.
- The page shows no ids, billing or seller email, and is served with `no-store`, `no-referrer` and `noindex`.
- Limits: 60 views/minute per address; renewal requests 10/hour per address and 3/day per link; one open request per customer.
- **Seller side:** requests appear on the dashboard (**درخواست‌های تمدید مشتریان**) and as a Telegram message. Approve =
  renew with the same rules and billing as a manual renewal (the request is claimed first so a double click can't renew
  twice, and reopened if the renewal fails). Reject closes it and lets the customer ask again.
- Branding: **اعلان‌ها** → صفحه مشتری (display name, support contact).

The app download links in `src/lib/client-apps.ts` are suggestions, verify and edit them for your audience.

## Notifications (Telegram)

Setup: [Telegram setup guide](telegram.md). Messages are plain text, queued in a database outbox and sent by a background job
every minute; a scan job runs hourly.

| Event             | To          | When                                                                                      |
| ----------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Plan ending       | seller      | active customer expires within 3 days (once per expiry date, so a renewal can warn again) |
| High usage        | seller      | customer ≥ 90% of quota (once per quota cycle)                                            |
| Low wallet        | seller      | wallet users only, when `balance − debt < 50,000` toman (at most weekly)                  |
| Top-up requested  | every admin | seller submits a request                                                                  |
| Top-up decided    | seller      | approved / rejected / gateway paid or failed                                              |
| Renewal requested | seller      | customer asks from their page                                                             |

Delivery: failures retry with growing delays (2, 4, 8… minutes, up to 6 hours) for 6 attempts, then stop. A blocked bot
or deleted chat stops immediately and removes the link. Rate-limit waits from Telegram are respected. A recipient with
no linked chat is skipped. The notifications page shows queue counts and recent errors (admins).

## Security behaviour worth knowing

- Sign-in is limited to 5 attempts per minute per address; the password-change endpoint 5 per 5 minutes.
- Public self-signup is disabled; only an admin creates sellers. The first admin comes from the bootstrap flow or the CLI.
- Roles are re-read from the database on each request, so a demoted admin loses access immediately.
- Passwords created by the CLI must be ≥ 12 characters. The login form still accepts shorter ones, because some existing
  accounts have them.
- Secrets in the database (bot token, gateway credentials) are encrypted with a key derived from `BETTER_AUTH_SECRET`.

## Announcements

Admin → **وضعیت سامانه** → اطلاعیه: a message (info or warning) shown at the top of every page for everyone, until you
switch it off.
