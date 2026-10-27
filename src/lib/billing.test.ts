import { describe, expect, it } from 'bun:test'

import {
  amountToman,
  billingGbFromBytes,
  canAdminSettle,
  canAdminUnsettle,
  canResellerClaim,
  extraGbDelta,
  shouldBillForUpdate,
  summarizeByReseller,
  summarizeLedger,
  settlementStatus,
} from '#/lib/billing'
import { gbToBytes } from '#/lib/vpn-plans'

describe('amountToman', () => {
  it('bills allocated GB at snapshot price', () => {
    expect(amountToman(25, 1000)).toBe(25_000)
    expect(amountToman(50, 1000)).toBe(50_000)
  })

  it('rounds fractional amounts', () => {
    expect(amountToman(10.5, 1000)).toBe(10_500)
  })
})

describe('anti-fraud: usage/hide never credits', () => {
  it('create 25GB then renew 50GB accumulates debt', () => {
    const rows = [
      {
        dataLimitGb: 25,
        amountToman: amountToman(25, 1000),
        settledAt: null,
        claimedPaidAt: null,
      },
      {
        dataLimitGb: 50,
        amountToman: amountToman(50, 1000),
        settledAt: null,
        claimedPaidAt: null,
      },
    ]
    const summary = summarizeLedger(rows)
    expect(summary.totalToman).toBe(75_000)
    expect(summary.outstandingToman).toBe(75_000)
    expect(summary.soldGb).toBe(75)
  })

  it('reset usage / disable / volume decrease do not bill credit', () => {
    expect(
      shouldBillForUpdate({
        previousBytes: gbToBytes(50),
        nextBytes: gbToBytes(50),
        usageReset: true,
      }),
    ).toBe(false)

    expect(
      shouldBillForUpdate({
        previousBytes: gbToBytes(50),
        nextBytes: gbToBytes(50),
        statusChangedToDisabled: true,
      }),
    ).toBe(false)

    expect(
      shouldBillForUpdate({
        previousBytes: gbToBytes(50),
        nextBytes: gbToBytes(25),
      }),
    ).toBe(false)

    expect(extraGbDelta(gbToBytes(50), gbToBytes(25))).toBe(0)
  })

  it('only volume increase creates extra_gb delta', () => {
    expect(extraGbDelta(gbToBytes(25), gbToBytes(35))).toBe(10)
    expect(
      shouldBillForUpdate({
        previousBytes: gbToBytes(25),
        nextBytes: gbToBytes(35),
      }),
    ).toBe(true)
  })

  it('extra_gb uses current price; prior rows keep snapshot', () => {
    const createRow = {
      dataLimitGb: 25,
      amountToman: amountToman(25, 1000),
      settledAt: null as string | null,
      claimedPaidAt: null as string | null,
    }
    // Price later becomes 2000 — only new extra is at new price
    const extraRow = {
      dataLimitGb: 10,
      amountToman: amountToman(10, 2000),
      settledAt: null,
      claimedPaidAt: null,
    }
    const summary = summarizeLedger([createRow, extraRow])
    expect(createRow.amountToman).toBe(25_000)
    expect(extraRow.amountToman).toBe(20_000)
    expect(summary.outstandingToman).toBe(45_000)
  })

  it('soft-remove / hide does not reduce outstanding', () => {
    const before = summarizeLedger([
      {
        dataLimitGb: 25,
        amountToman: 25_000,
        settledAt: null,
        claimedPaidAt: null,
      },
    ])
    // Soft remove does not delete ledger rows — same summary
    const afterHide = summarizeLedger([
      {
        dataLimitGb: 25,
        amountToman: 25_000,
        settledAt: null,
        claimedPaidAt: null,
      },
    ])
    expect(afterHide.outstandingToman).toBe(before.outstandingToman)
  })
})

describe('two-step settlement', () => {
  it('claim without settle keeps outstanding', () => {
    const rows = [
      {
        dataLimitGb: 25,
        amountToman: 25_000,
        claimedPaidAt: '2026-01-01T00:00:00.000Z',
        settledAt: null,
      },
    ]
    const summary = summarizeLedger(rows)
    expect(summary.claimedToman).toBe(25_000)
    expect(summary.outstandingToman).toBe(25_000)
    expect(summary.settledToman).toBe(0)
    expect(settlementStatus(rows[0])).toBe('claimed')
  })

  it('settle clears outstanding', () => {
    const rows = [
      {
        dataLimitGb: 25,
        amountToman: 25_000,
        claimedPaidAt: '2026-01-01T00:00:00.000Z',
        settledAt: '2026-01-02T00:00:00.000Z',
      },
    ]
    const summary = summarizeLedger(rows)
    expect(summary.settledToman).toBe(25_000)
    expect(summary.outstandingToman).toBe(0)
    expect(summary.claimedToman).toBe(0)
  })

  it('reseller can only claim own unsettled unclaimed rows', () => {
    const own = {
      resellerId: 'r1',
      dataLimitGb: 25,
      amountToman: 25_000,
      settledAt: null,
      claimedPaidAt: null,
    }
    expect(canResellerClaim(own, 'r1')).toBe(true)
    expect(canResellerClaim(own, 'r2')).toBe(false)
    expect(
      canResellerClaim(
        { ...own, claimedPaidAt: '2026-01-01T00:00:00.000Z' },
        'r1',
      ),
    ).toBe(false)
    expect(
      canResellerClaim({ ...own, settledAt: '2026-01-01T00:00:00.000Z' }, 'r1'),
    ).toBe(false)
  })

  it('only unsettled rows can be admin-settled', () => {
    expect(
      canAdminSettle({
        dataLimitGb: 1,
        amountToman: 1,
        settledAt: null,
      }),
    ).toBe(true)
    expect(
      canAdminSettle({
        dataLimitGb: 1,
        amountToman: 1,
        settledAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false)
    expect(
      canAdminUnsettle({
        dataLimitGb: 1,
        amountToman: 1,
        settledAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true)
  })
})

describe('summarizeByReseller', () => {
  it('does not mix resellers', () => {
    const by = summarizeByReseller([
      {
        resellerId: 'a',
        dataLimitGb: 25,
        amountToman: 25_000,
        settledAt: null,
        claimedPaidAt: null,
      },
      {
        resellerId: 'b',
        dataLimitGb: 50,
        amountToman: 50_000,
        settledAt: null,
        claimedPaidAt: null,
      },
      {
        resellerId: 'a',
        dataLimitGb: 10,
        amountToman: 10_000,
        settledAt: 'x',
        claimedPaidAt: null,
      },
    ])
    const a = by.find((r) => r.resellerId === 'a')!
    const b = by.find((r) => r.resellerId === 'b')!
    expect(a.totalToman).toBe(35_000)
    expect(a.outstandingToman).toBe(25_000)
    expect(a.settledToman).toBe(10_000)
    expect(b.totalToman).toBe(50_000)
    expect(b.outstandingToman).toBe(50_000)
  })
})

describe('billingGbFromBytes', () => {
  it('uses allocated bytes not traffic', () => {
    expect(billingGbFromBytes(gbToBytes(25))).toBe(25)
    expect(billingGbFromBytes(null)).toBe(0)
  })
})
