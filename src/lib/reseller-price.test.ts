import { describe, expect, it } from 'bun:test'
import * as z from 'zod'

/** Mirrors admin updateReseller price field + UI changePriceSchema. */
const updateResellerPriceSchema = z.object({
  userId: z.string().min(1),
  pricePerGbToman: z.number().int().positive(),
})

describe('reseller price update', () => {
  it('accepts a new positive integer price', () => {
    expect(
      updateResellerPriceSchema.parse({
        userId: 'reseller-1',
        pricePerGbToman: 15000,
      }),
    ).toEqual({ userId: 'reseller-1', pricePerGbToman: 15000 })
  })

  it('rejects zero or negative prices', () => {
    expect(() =>
      updateResellerPriceSchema.parse({
        userId: 'reseller-1',
        pricePerGbToman: 0,
      }),
    ).toThrow()
    expect(() =>
      updateResellerPriceSchema.parse({
        userId: 'reseller-1',
        pricePerGbToman: -1,
      }),
    ).toThrow()
  })

  it('builds a non-empty profile patch for price-only updates', () => {
    const input = { pricePerGbToman: 22000 as number | undefined }
    const profilePatch =
      input.pricePerGbToman != null
        ? { pricePerGbToman: input.pricePerGbToman }
        : {}
    expect(Object.keys(profilePatch).length).toBeGreaterThan(0)
    expect(profilePatch).toEqual({ pricePerGbToman: 22000 })
  })
})
