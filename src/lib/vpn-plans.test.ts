import { describe, expect, it } from 'bun:test'

import { buildVpnUsername, usernameSuffixSchema } from '#/lib/reseller-naming'
import {
  bytesToGb,
  gbToBytes,
  renewExpireAt,
  renewVpnUserFormSchema,
  editVpnUserFormSchema,
} from '#/lib/vpn-plans'

describe('buildVpnUsername', () => {
  it('builds suffix_local usernames', () => {
    expect(buildVpnUsername('Example', 'name1')).toBe('example_name1')
    expect(buildVpnUsername(' shop ', ' ali ')).toBe('shop_ali')
  })
})

describe('usernameSuffixSchema', () => {
  it('accepts valid suffixes', () => {
    expect(usernameSuffixSchema.parse('Example')).toBe('example')
  })

  it('rejects invalid suffixes', () => {
    expect(() => usernameSuffixSchema.parse('1bad')).toThrow()
    expect(() => usernameSuffixSchema.parse('a')).toThrow()
  })
})

describe('gb helpers', () => {
  it('converts gb <-> bytes', () => {
    expect(gbToBytes(25)).toBe(25 * 1024 ** 3)
    expect(bytesToGb(gbToBytes(50))).toBe(50)
    expect(bytesToGb(null)).toBeNull()
  })
})

describe('renewExpireAt', () => {
  const now = new Date('2026-01-15T12:00:00.000Z')

  it.each([30, 60, 90] as const)(
    'starts a %i-day renewal from today',
    (days) => {
      const current = new Date('2026-02-01T12:00:00.000Z')
      const next = renewExpireAt(current, days, now)
      expect(next?.getTime()).toBe(now.getTime() + days * 86_400_000)
    },
  )

  it('starts from now when already expired', () => {
    const current = new Date('2026-01-01T12:00:00.000Z')
    const next = renewExpireAt(current, 60, now)
    expect(next?.toISOString()).toBe('2026-03-16T12:00:00.000Z')
  })

  it('starts from now when expire is missing', () => {
    const next = renewExpireAt(null, 90, now)
    expect(next?.toISOString()).toBe('2026-04-15T12:00:00.000Z')
  })
  it('clears expiry for unlimited renewals', () => {
    const current = new Date('2026-02-01T12:00:00.000Z')
    expect(renewExpireAt(current, 0, now)).toBeNull()
  })
})

describe('edit/renew form schemas', () => {
  it('validates edit payload', () => {
    expect(
      editVpnUserFormSchema.parse({ dataLimitGb: 25, note: 'ok' }),
    ).toEqual({ dataLimitGb: 25, note: 'ok' })
    expect(() => editVpnUserFormSchema.parse({ dataLimitGb: 5 })).toThrow()
  })

  it('validates renew payload', () => {
    expect(
      renewVpnUserFormSchema.parse({
        durationDays: 60,
        additionalDataLimitGb: 50,
        reactivate: true,
      }),
    ).toMatchObject({ durationDays: 60, additionalDataLimitGb: 50 })
    expect(
      renewVpnUserFormSchema.parse({
        durationDays: 0,
        additionalDataLimitGb: 50,
        reactivate: true,
      }),
    ).toMatchObject({ durationDays: 0 })
    expect(() =>
      renewVpnUserFormSchema.parse({
        durationDays: 4,
        additionalDataLimitGb: 50,
        reactivate: false,
      }),
    ).toThrow()
  })
})
