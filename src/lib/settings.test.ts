import { expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../test/helpers/db'
import { settings } from '#/db/schema'
import { decryptJson, encryptJson, getSetting, setSetting } from './settings'

const db = await createTestDb()

it('round-trips encrypted JSON and never stores plaintext', async () => {
  await setSetting(
    'secret.demo',
    { token: 'super-secret-token' },
    { encrypted: true },
    db,
  )
  const [raw] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'secret.demo'))
  expect(raw?.encrypted).toBe(true)
  expect(raw?.valueJson).not.toContain('super-secret-token')
  expect(await getSetting('secret.demo', db)).toEqual({
    token: 'super-secret-token',
  })
})

it('upserts plain settings', async () => {
  await setSetting('banner', { text: 'a' }, {}, db)
  await setSetting('banner', { text: 'b' }, {}, db)
  expect(await getSetting('banner', db)).toEqual({ text: 'b' })
  expect(await getSetting('missing', db)).toBeNull()
})

it('fails to decrypt with a different secret or tampered data', async () => {
  const enc = await encryptJson({ a: 1 }, 'x'.repeat(40))
  await expect(decryptJson(enc, 'y'.repeat(40))).rejects.toThrow()
  const [iv, cipher] = enc.split('.')
  const tampered = `${iv}.${cipher.slice(0, -4)}AAAA`
  await expect(decryptJson(tampered, 'x'.repeat(40))).rejects.toThrow()
})
