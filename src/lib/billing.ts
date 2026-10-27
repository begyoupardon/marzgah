import { BYTES_PER_GB, bytesToGb } from '#/lib/vpn-plans'

export type BillingEventType = 'create' | 'renew' | 'extra_gb'

export type LedgerRowLike = {
  dataLimitGb: number
  amountToman: number
  claimedPaidAt?: Date | string | null
  settledAt?: Date | string | null
  resellerId?: string
}

export type LedgerSummary = {
  soldGb: number
  totalToman: number
  settledToman: number
  claimedToman: number
  outstandingToman: number
  eventCount: number
}

export function amountToman(gb: number, pricePerGbToman: number) {
  if (!Number.isFinite(gb) || !Number.isFinite(pricePerGbToman)) return 0
  return Math.round(gb * pricePerGbToman)
}

/** Billing GB from allocated bytes (never usedTraffic). */
export function billingGbFromBytes(bytes: number | null | undefined) {
  return bytesToGb(bytes) ?? 0
}

export function extraGbDelta(
  previousBytes: number | null | undefined,
  nextBytes: number | null | undefined,
) {
  const prev = billingGbFromBytes(previousBytes)
  const next = billingGbFromBytes(nextBytes)
  const delta = Math.round((next - prev) * 100) / 100
  return delta > 0 ? delta : 0
}

export function isSettled(row: LedgerRowLike) {
  return row.settledAt != null && row.settledAt !== ''
}

export function isClaimed(row: LedgerRowLike) {
  return row.claimedPaidAt != null && row.claimedPaidAt !== ''
}

/**
 * Outstanding debt ignores reseller "I paid" claims until admin settles.
 * Claimed totals are rows claimed but not yet settled.
 */
export function summarizeLedger(rows: LedgerRowLike[]): LedgerSummary {
  let soldGb = 0
  let totalToman = 0
  let settledToman = 0
  let claimedToman = 0
  let outstandingToman = 0

  for (const row of rows) {
    soldGb += row.dataLimitGb
    totalToman += row.amountToman
    if (isSettled(row)) {
      settledToman += row.amountToman
    } else {
      outstandingToman += row.amountToman
      if (isClaimed(row)) {
        claimedToman += row.amountToman
      }
    }
  }

  return {
    soldGb: Math.round(soldGb * 100) / 100,
    totalToman,
    settledToman,
    claimedToman,
    outstandingToman,
    eventCount: rows.length,
  }
}

export function summarizeByReseller(
  rows: Array<LedgerRowLike & { resellerId: string }>,
) {
  const map = new Map<string, LedgerRowLike[]>()
  for (const row of rows) {
    const list = map.get(row.resellerId) ?? []
    list.push(row)
    map.set(row.resellerId, list)
  }

  return [...map.entries()].map(([resellerId, list]) => ({
    resellerId,
    ...summarizeLedger(list),
  }))
}

export function settlementStatus(
  row: LedgerRowLike,
): 'settled' | 'claimed' | 'outstanding' {
  if (isSettled(row)) return 'settled'
  if (isClaimed(row)) return 'claimed'
  return 'outstanding'
}

export function canResellerClaim(
  row: LedgerRowLike & { resellerId: string },
  resellerUserId: string,
) {
  return row.resellerId === resellerUserId && !isSettled(row) && !isClaimed(row)
}

export function canAdminSettle(row: LedgerRowLike) {
  return !isSettled(row)
}

export function canAdminUnsettle(row: LedgerRowLike) {
  return isSettled(row)
}

/** Pure policy: disable/reset/revoke/volume-decrease never create credit. */
export function shouldBillForUpdate(args: {
  previousBytes: number | null | undefined
  nextBytes: number | null | undefined
  statusChangedToDisabled?: boolean
  usageReset?: boolean
}) {
  if (args.statusChangedToDisabled || args.usageReset) return false
  return extraGbDelta(args.previousBytes, args.nextBytes) > 0
}

export function gbToBillingBytes(gb: number) {
  return Math.round(gb * BYTES_PER_GB)
}
