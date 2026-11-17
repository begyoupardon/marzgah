import { eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { accessAssignments, accessPolicies, vpnUsers } from '#/db/schema'
import { getAssignment } from './access-store'
import {
  accessPolicySchema,
  baseInbounds,
  effectiveInbounds,
  effectiveUserSelection,
} from './access-policy'
import { getBackend } from './backends/registry'
import type { SubscriptionFormat } from './backends/types'
import { getEnv } from './env'
import { createRateLimiter, clientIp } from './rate-limit'
import { filterSubscription } from './subscription-filter'
import { resolveSubscriptionUrl } from './marzban/subscription-url'

type Account = {
  id: string
  backend: string
  resellerId: string
  marzbanUsername: string
  subscriptionUrl: string | null
}
const limiter = createRateLimiter({ windowMs: 60_000, max: 60 })
function selectionFrom(
  account: Account,
  policy: ReturnType<typeof accessPolicySchema.parse>,
  assignment: typeof accessAssignments.$inferSelect | null,
) {
  const selection = effectiveUserSelection(
    policy,
    account.resellerId,
    assignment,
  )
  if (!assignment && selection.mode === 'custom' && !selection.inbounds.length)
    return null
  return effectiveInbounds(policy, {
    mode: 'custom',
    inbounds: baseInbounds(policy, selection),
  })
}
async function selectionFor(account: Account) {
  const [row] = await db
    .select()
    .from(accessPolicies)
    .where(eq(accessPolicies.backend, account.backend))
  if (!row) return null
  return selectionFrom(
    account,
    accessPolicySchema.parse(JSON.parse(row.document)),
    await getAssignment(account.id),
  )
}
function credential(account: Account, raw: string) {
  return `subscription:v1:${account.id}:${account.backend}:${account.marzbanUsername}:${new URL(raw, 'https://subscription.invalid').pathname}`
}
async function key() {
  const secret = getEnv().BETTER_AUTH_SECRET
  if (!secret) throw new Error('Subscription signing is not configured')
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}
async function signedUrl(
  account: Account,
  raw: string,
  signingKey: Promise<CryptoKey>,
) {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey,
    new TextEncoder().encode(credential(account, raw)),
  )
  const base = getEnv().BETTER_AUTH_URL
  if (!base) throw new Error('Panel URL is not configured')
  return new URL(
    `/subscription/${encodeURIComponent(account.id)}/${Buffer.from(signature).toString('base64url')}`,
    base,
  ).href
}
export async function publicSubscriptionUrl(
  account: Account,
): Promise<string | null> {
  const raw = resolveSubscriptionUrl(account.subscriptionUrl)
  if (!raw) return null
  const selection = await selectionFor(account)
  return selection?.some((i) => i.hostIds)
    ? signedUrl(account, raw, key())
    : raw
}
/** Two metadata queries for an entire user page, including on D1. */
export async function publicSubscriptionUrls(
  accounts: Account[],
): Promise<Array<string | null>> {
  const usable = accounts.filter((a) => a.subscriptionUrl)
  if (!usable.length) return accounts.map(() => null)
  const policies = await db
    .select()
    .from(accessPolicies)
    .where(
      inArray(accessPolicies.backend, [
        ...new Set(usable.map((a) => a.backend)),
      ]),
    )
  if (!policies.length)
    return accounts.map((a) => resolveSubscriptionUrl(a.subscriptionUrl))
  const assignments = await db
    .select()
    .from(accessAssignments)
    .where(
      inArray(
        accessAssignments.vpnUserId,
        usable.map((a) => a.id),
      ),
    )
  const byBackend = new Map(
    policies.map((p) => [
      p.backend,
      accessPolicySchema.parse(JSON.parse(p.document)),
    ]),
  )
  const byUser = new Map(assignments.map((a) => [a.vpnUserId, a]))
  let signingKey: Promise<CryptoKey> | undefined
  return Promise.all(
    accounts.map(async (account) => {
      const raw = resolveSubscriptionUrl(account.subscriptionUrl)
      const policy = byBackend.get(account.backend)
      if (!raw || !policy) return raw
      const selection = selectionFrom(
        account,
        policy,
        byUser.get(account.id) ?? null,
      )
      return selection?.some((i) => i.hostIds)
        ? signedUrl(account, raw, (signingKey ??= key()))
        : raw
    }),
  )
}
export function subscriptionFormat(request: Request): SubscriptionFormat {
  const format = new URL(request.url).searchParams.get('format')
  if (
    format &&
    [
      'v2ray',
      'clash',
      'clash-meta',
      'sing-box',
      'v2ray-json',
      'outline',
    ].includes(format)
  )
    return format as SubscriptionFormat
  if (format) throw new Error('Unsupported subscription format')
  const agent = request.headers.get('user-agent') ?? ''
  if (/sing-box|singbox|hiddify/i.test(agent)) return 'sing-box'
  if (/clash.verge|clash.meta|mihomo|flclash/i.test(agent)) return 'clash-meta'
  if (/clash|stash/i.test(agent)) return 'clash'
  return 'v2ray'
}
export async function serveManagedSubscription(
  request: Request,
  id: string,
  token: string,
) {
  const headers = {
    'cache-control': 'no-store, private',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
    'x-content-type-options': 'nosniff',
  }
  const missing = () =>
    new Response('Subscription unavailable', { status: 404, headers })
  if (!limiter.hit(clientIp(request.headers)).allowed)
    return new Response('Try again later', {
      status: 429,
      headers: { ...headers, 'retry-after': '60' },
    })
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return missing()
  const [account] = await db.select().from(vpnUsers).where(eq(vpnUsers.id, id))
  if (!account || account.removedAt || !account.subscriptionUrl)
    return missing()
  const valid = async (raw: string) =>
    crypto.subtle.verify(
      'HMAC',
      await key(),
      new Uint8Array(Buffer.from(token, 'base64url')),
      new TextEncoder().encode(credential(account, raw)),
    )
  if (!(await valid(account.subscriptionUrl))) return missing()
  let format: SubscriptionFormat
  try {
    format = subscriptionFormat(request)
  } catch {
    return new Response('Unsupported subscription format', {
      status: 400,
      headers,
    })
  }
  try {
    const backend = getBackend(account.backend)
    const current = await backend.getUser(account.marzbanUsername, {
      repair: false,
    })
    if (
      !(await valid(current.subscriptionUrl)) ||
      !['active', 'on_hold'].includes(current.status)
    )
      return missing()
    if (!backend.getSubscription || !backend.accessCatalog)
      throw new Error('Subscription backend unavailable')
    const upstream = await backend.getSubscription(
      account.marzbanUsername,
      format,
    )
    const catalog = await backend.accessCatalog()
    const latest = await backend.getUser(account.marzbanUsername, {
      repair: false,
    })
    if (
      !(await valid(latest.subscriptionUrl)) ||
      !['active', 'on_hold'].includes(latest.status)
    )
      return missing()
    const selection = await selectionFor(account)
    const result = selection?.some((i) => i.hostIds)
      ? filterSubscription(
          upstream.body,
          format,
          catalog,
          selection,
          account.marzbanUsername,
        )
      : upstream
    return new Response(result.body, {
      headers: {
        ...headers,
        'content-type': result.contentType,
        'profile-update-interval': '1',
        'subscription-userinfo': `upload=0; download=${current.usedBytes}; total=${current.dataLimitBytes ?? 0}; expire=${current.expireAt ? Math.floor(current.expireAt.getTime() / 1000) : 0}`,
      },
    })
  } catch {
    return new Response('Subscription temporarily unavailable', {
      status: 503,
      headers: { ...headers, 'retry-after': '15' },
    })
  }
}
