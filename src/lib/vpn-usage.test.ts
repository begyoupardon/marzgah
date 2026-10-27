import { expect, it } from 'bun:test'
import { remainingDays, remainingTrafficBytes } from './vpn-usage'

it.each([null, 0])('treats quota %s as unlimited', (limit) => {
  expect(remainingTrafficBytes(10, limit)).toBeNull()
})
it('calculates remaining traffic and clamps exceeded limits', () => {
  expect(remainingTrafficBytes(10, 100)).toBe(90)
  expect(remainingTrafficBytes(150, 100)).toBe(0)
})
it('calculates remaining days from the absolute expiry', () => {
  expect(
    remainingDays('2030-01-02T00:00:00Z', Date.parse('2030-01-01T00:00:00Z')),
  ).toBe(1)
  expect(
    remainingDays('2030-01-01T00:00:00Z', Date.parse('2030-01-02T00:00:00Z')),
  ).toBe(0)
})
it('rounds a partial remaining day up', () => {
  expect(
    remainingDays('2030-01-01T12:00:00Z', Date.parse('2030-01-01T00:00:00Z')),
  ).toBe(1)
})
it('handles unlimited and invalid expiry', () => {
  expect(remainingDays(null)).toBeNull()
  expect(remainingDays('invalid')).toBeNull()
})
