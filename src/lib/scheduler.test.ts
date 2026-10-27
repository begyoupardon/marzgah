import { expect, it } from 'bun:test'

import { createScheduler } from './scheduler'

it('never overlaps runs of the same job', async () => {
  let release!: () => void
  let calls = 0
  const s = createScheduler()
  s.register({
    name: 'slow',
    intervalMs: 1,
    run: () => {
      calls++
      return new Promise<void>((r) => (release = r))
    },
  })
  const first = s.runJob('slow')
  expect(s.isRunning('slow')).toBe(true)
  expect(await s.runJob('slow')).toBe(false)
  release()
  await first
  expect(calls).toBe(1)
  expect(s.isRunning('slow')).toBe(false)
})

it('reports failures and keeps other jobs working', async () => {
  const failures: string[] = []
  const s = createScheduler({ onFailure: (job) => failures.push(job) })
  let ok = 0
  s.register({
    name: 'bad',
    intervalMs: 1,
    run: () => {
      throw new Error('x')
    },
  })
  s.register({
    name: 'good',
    intervalMs: 1,
    run: () => {
      ok++
    },
  })
  expect(await s.runJob('bad')).toBe(false)
  expect(await s.runJob('good')).toBe(true)
  expect(failures).toEqual(['bad'])
  expect(ok).toBe(1)
})

it('schedules each job on its interval and stops cleanly', () => {
  const intervals: number[] = []
  const cleared: unknown[] = []
  const s = createScheduler({
    setTimer: ((_fn: () => void, ms: number) => {
      intervals.push(ms)
      return intervals.length as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval,
    clearTimer: ((t: unknown) =>
      cleared.push(t)) as unknown as typeof clearInterval,
    setDelay: (() => 0) as unknown as typeof setTimeout,
  })
  s.register({ name: 'a', intervalMs: 100, run: () => {} })
  s.register({ name: 'b', intervalMs: 200, run: () => {} })
  s.start()
  expect(intervals).toEqual([100, 200])
  s.stop()
  expect(cleared).toHaveLength(2)
})
