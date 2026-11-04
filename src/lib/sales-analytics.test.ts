import { expect, it } from 'bun:test'

import { buildDailyTrend, localDayStarts } from './sales-analytics'

it('keeps chart amounts on the local days supplied to billing', () => {
  const starts = localDayStarts(2, new Date('2026-11-04T12:00:00+03:30'))
  expect(starts).toHaveLength(3)
  expect(starts.every((start) => new Date(start).getHours() === 0)).toBe(true)
  const trend = buildDailyTrend([100, 200], starts, 'en')
  expect(trend.map((day) => day.amount)).toEqual([100, 200])
  expect(trend.map((day) => day.date)).toEqual(
    starts.slice(0, 2).map((start) => {
      const day = new Date(start)
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    }),
  )
})
