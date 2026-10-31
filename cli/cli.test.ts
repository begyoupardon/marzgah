import { afterAll, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'

const dir = mkdtempSync(join(tmpdir(), 'vpnpanel-cli-'))
const dbPath = join(dir, 'panel.db')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function cli(...args: string[]) {
  const proc = Bun.spawnSync(['bun', 'run', 'cli/index.ts', ...args], {
    cwd: join(import.meta.dir, '..'),
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
  })
  return {
    code: proc.exitCode,
    out: proc.stdout.toString() + proc.stderr.toString(),
  }
}

const count = (path: string) => {
  const db = new Database(path, { readonly: true })
  const row = db.query('select count(*) as c from user').get() as { c: number }
  db.close()
  return row.c
}

it('migrate, create-admin, backup and restore round-trip', () => {
  expect(cli('migrate').code).toBe(0)
  expect(
    cli(
      'create-admin',
      '--email',
      'a@b.test',
      '--password',
      'correct-horse-battery',
    ).code,
  ).toBe(0)
  expect(count(dbPath)).toBe(1)

  const backup = join(dir, 'b', 'panel-x.db')
  expect(cli('backup', '--out', backup).code).toBe(0)
  expect(existsSync(backup)).toBe(true)

  cli(
    'create-admin',
    '--email',
    'c@d.test',
    '--password',
    'correct-horse-battery',
  )
  expect(count(dbPath)).toBe(2)

  expect(cli('restore', backup).code).toBe(0)
  expect(count(dbPath)).toBe(1)
})

it('rejects short admin passwords', () => {
  const r = cli('create-admin', '--email', 'e@f.test', '--password', 'short')
  expect(r.code).not.toBe(0)
})

it('exposes the upgrade command', () => {
  expect(cli('--help').out).toContain('upgrade')
  expect(cli('upgrade', '--help').out).toContain('Back up and upgrade')
})
