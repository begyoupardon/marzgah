import { expect, it } from 'bun:test'

import { withKeyedLock } from './keyed-lock'

it('runs same-key tasks one at a time, in order, even after a failure', async () => {
  const log: string[] = []
  const task =
    (name: string, ms: number, fail = false) =>
    () =>
      (async () => {
        log.push(`start ${name}`)
        await new Promise((r) => setTimeout(r, ms))
        log.push(`end ${name}`)
        if (fail) throw new Error(name)
        return name
      })()
  const a = withKeyedLock('k', task('a', 20, true))
  const b = withKeyedLock('k', task('b', 1))
  const other = withKeyedLock('other', task('c', 1))
  await expect(a).rejects.toThrow('a')
  expect(await b).toBe('b')
  await other
  expect(log.indexOf('end a')).toBeLessThan(log.indexOf('start b'))
  expect(log.indexOf('start c')).toBeLessThan(log.indexOf('end a'))
})
