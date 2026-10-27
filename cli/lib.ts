import { configureMigrationPath } from './paths'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

import * as p from '@clack/prompts'

export function cancelIfAborted<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    process.exit(1)
  }
  return value as Exclude<T, symbol>
}

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

/** Load KEY=VALUE pairs from a file into process.env without overriding. */
export function loadEnvFile(path = '.env') {
  const contents = existsSync(path) ? readFileSync(path, 'utf8') : ''
  for (const line of contents.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  configureMigrationPath()
}

export function databasePath() {
  return process.env.DATABASE_PATH ?? './data/panel.db'
}

export function serializeEnv(values: Record<string, string | undefined>) {
  return (
    Object.entries(values)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  )
}
