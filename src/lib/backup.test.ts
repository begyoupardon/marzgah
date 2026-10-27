import { afterAll, expect, it } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'

import { backupDatabase, backupFileName, rotateBackups } from './backup'

const dir = mkdtempSync(join(tmpdir(), 'backup-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

it('writes a consistent copy of a live database', async () => {
  const src = join(dir, 'src.db')
  const db = new Database(src)
  db.exec(
    'PRAGMA journal_mode = WAL; create table t(x); insert into t values (1),(2)',
  )
  const out = await backupDatabase(src, join(dir, 'out', 'panel-a.db'))
  expect(existsSync(out)).toBe(true)
  const copy = new Database(out, { readonly: true })
  expect(
    (copy.query('select count(*) c from t').get() as { c: number }).c,
  ).toBe(2)
  copy.close()
  db.close()
})

it('rotates old backups, keeping the newest', () => {
  const d = join(dir, 'rot')
  Bun.spawnSync(['mkdir', '-p', d])
  for (const n of ['a', 'b', 'c', 'd'])
    writeFileSync(join(d, `panel-${n}.db`), n)
  writeFileSync(join(d, 'notes.txt'), 'keep me')
  const removed = rotateBackups(d, 2)
  expect(removed.sort()).toEqual(['panel-a.db', 'panel-b.db'])
  expect(readdirSync(d).sort()).toEqual([
    'notes.txt',
    'panel-c.db',
    'panel-d.db',
  ])
})

it('builds filesystem-safe, sortable names', () => {
  const name = backupFileName(new Date('2026-01-02T03:04:05.678Z'))
  expect(name).toBe('panel-2026-01-02T03-04-05-678Z.db')
})
