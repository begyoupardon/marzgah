import { expect, it } from 'bun:test'

import { envProblems, getEnv } from './env'

it('normalizes blanks and trailing slashes', () => {
  const env = getEnv({
    MARZBAN_BASE_URL: 'https://m.test/',
    MARZBAN_USERNAME: ' ',
  })
  expect(env.MARZBAN_BASE_URL).toBe('https://m.test')
  expect(env.MARZBAN_USERNAME).toBeUndefined()
  expect(env.BACKUP_KEEP).toBe(14)
  expect(env.SCHEDULER).toBe(true)
})

it('flags weak or missing auth config', () => {
  expect(envProblems(getEnv({}))).toHaveLength(2)
  expect(
    envProblems(
      getEnv({
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        BETTER_AUTH_URL: 'https://p.test',
      }),
    ),
  ).toEqual([])
})

it('can disable the scheduler', () => {
  expect(getEnv({ SCHEDULER: 'off' }).SCHEDULER).toBe(false)
})
