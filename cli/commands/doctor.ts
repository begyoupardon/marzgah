import { existsSync } from 'node:fs'

import * as p from '@clack/prompts'
import { defineCommand } from 'citty'

import { databasePath, loadEnvFile } from '../lib.ts'
import { inspectAccessSchema } from '../access-status.ts'

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check config, DB and Marzban connectivity',
  },
  args: {
    offline: {
      type: 'boolean',
      default: false,
      description:
        'Check local config and schema without contacting the VPN backend',
    },
  },
  async run({ args }) {
    loadEnvFile()
    const results: Array<[string, boolean, string]> = []
    const check = (name: string, ok: boolean, detail = '') =>
      results.push([name, ok, detail])

    const secret = process.env.BETTER_AUTH_SECRET ?? ''
    check('BETTER_AUTH_SECRET (>=32 chars)', secret.length >= 32)
    check('BETTER_AUTH_URL', !!process.env.BETTER_AUTH_URL)
    check('MARZBAN_WEBHOOK_SECRET', !!process.env.MARZBAN_WEBHOOK_SECRET)
    check('Database file', existsSync(databasePath()), databasePath())
    const access = inspectAccessSchema(databasePath())
    check('Connection access schema', access.ok, access.detail)

    const { getBackend } = await import('../../src/lib/backends/registry.ts')
    const backend = getBackend()
    const info = backend.info()
    if (!info.configured) {
      check(`${info.label} configuration`, false, 'missing credentials')
    } else if (args.offline) {
      check(`${info.label} connectivity`, true, 'not checked (--offline)')
    } else {
      try {
        await backend.health()
        check(`${info.label} login`, true, info.baseUrl ?? '')
      } catch (e) {
        check(
          `${info.label} login`,
          false,
          e instanceof Error ? e.message : String(e),
        )
      }
    }

    for (const [name, ok, detail] of results) {
      p.log[ok ? 'success' : 'error'](`${name}${detail ? ` — ${detail}` : ''}`)
    }
    if (process.env.SCHEDULER === 'off') {
      p.log.warn(
        'SCHEDULER=off: queued access changes will not apply automatically. Enable one scheduler instance or configure authenticated access.drain calls; see docs/connection-access.md.',
      )
    } else {
      p.log.info(
        'Access worker: enabled by configuration. After restarting the panel, verify pending/failed operations in Administration → Connection access.',
      )
    }
    if (results.some(([, ok]) => !ok)) process.exit(1)
  },
})
