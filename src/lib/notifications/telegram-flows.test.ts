import { expect, it } from 'bun:test'

import { gbToBytes } from '#/lib/vpn-plans'
import { FLOWS } from './telegram-flows'

it('accepts a decimal 0.1 GB allowance in Telegram flows', async () => {
  const createGb = FLOWS.create.steps.find((step) => step.key === 'gb')!
  const renewGb = FLOWS.renew.steps.find((step) => step.key === 'extraGb')!
  expect(createGb.parse('۰٫۱', {})).toBe(0.1)
  expect(renewGb.parse('0.1', {})).toBe(0.1)
  expect(() => createGb.parse('0.05', {})).toThrow()
  expect(renewGb.parse('0', {})).toBe(0)

  const done = await FLOWS.create.finish(
    { username: 'small', gb: 0.1, days: 30 },
    {
      role: 'reseller',
      invoke: async () => ({ profile: { pricePerGbToman: 1000 } }),
    },
  )
  expect(done.kind).toBe('action')
  if (done.kind === 'action') {
    expect(done.input).toMatchObject({ dataLimitBytes: gbToBytes(0.1) })
    expect(done.summary).toContain('۰٫۱')
  }
})
