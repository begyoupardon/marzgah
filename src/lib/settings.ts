import { eq } from 'drizzle-orm'

import { db as defaultDb } from '#/db'
import { settings } from '#/db/schema'
import type { Db } from '#/db/types'
import { getEnv } from '#/lib/env'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

async function key(secret = getEnv().BETTER_AUTH_SECRET) {
  if (!secret)
    throw new Error('BETTER_AUTH_SECRET is required to encrypt settings')
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('vpn-panel/settings'),
      info: encoder.encode('aes-gcm'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(value: unknown, secret?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await key(secret),
      encoder.encode(JSON.stringify(value)),
    ),
  )
  return `${b64(iv)}.${b64(cipher)}`
}

export async function decryptJson<T>(
  payload: string,
  secret?: string,
): Promise<T> {
  const [iv, cipher] = payload.split('.')
  if (!iv || !cipher) throw new Error('Malformed encrypted value')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) },
    await key(secret),
    unb64(cipher),
  )
  return JSON.parse(decoder.decode(plain)) as T
}

export async function getSetting<T>(
  name: string,
  database: Db = defaultDb,
): Promise<T | null> {
  const [row] = await database
    .select()
    .from(settings)
    .where(eq(settings.key, name))
    .limit(1)
  if (!row) return null
  return row.encrypted
    ? decryptJson<T>(row.valueJson)
    : (JSON.parse(row.valueJson) as T)
}

export async function setSetting(
  name: string,
  value: unknown,
  options: { encrypted?: boolean } = {},
  database: Db = defaultDb,
) {
  const encrypted = options.encrypted ?? false
  const valueJson = encrypted ? await encryptJson(value) : JSON.stringify(value)
  await database
    .insert(settings)
    .values({ key: name, valueJson, encrypted })
    .onConflictDoUpdate({
      target: settings.key,
      set: { valueJson, encrypted, updatedAt: new Date() },
    })
}
