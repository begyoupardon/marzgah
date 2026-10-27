import { existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import * as p from '@clack/prompts'
import { defineCommand } from 'citty'

import { cancelIfAborted, randomSecret, serializeEnv } from '../lib.ts'

type Target = 'docker' | 'bun' | 'cloudflare'

const composeFile = (domain: string | null) => `services:
  panel:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_PATH: /data/panel.db
      BACKUP_DIR: /data/backups
    volumes:
      - panel-data:/data
${domain ? '    expose:\n      - "3000"' : '    ports:\n      - "3000:3000"'}
${
  domain
    ? `  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    command: caddy reverse-proxy --from ${domain} --to panel:3000
    volumes:
      - caddy-data:/data
    depends_on:
      - panel
`
    : ''
}volumes:
  panel-data:
${domain ? '  caddy-data:\n' : ''}`

async function testMarzban(url: string, user: string, pass: string) {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/admin/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: user, password: pass }),
    })
    return res.ok
  } catch {
    return false
  }
}

const sh = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { stdio: 'inherit' }).status === 0

export default defineCommand({
  meta: { name: 'init', description: 'Interactive first-time setup wizard' },
  async run() {
    p.intro('Marzgah setup')

    if (existsSync('.env')) {
      const overwrite = cancelIfAborted(
        await p.confirm({
          message: '.env already exists. Overwrite?',
          initialValue: false,
        }),
      )
      if (!overwrite) return p.cancel('Keeping the existing .env.')
    }

    const target = cancelIfAborted(
      await p.select<Target>({
        message: 'Where will the panel run?',
        options: [
          { value: 'docker', label: 'Docker + Bun (recommended for a VPS)' },
          { value: 'bun', label: 'Bun directly (no Docker)' },
          { value: 'cloudflare', label: 'Cloudflare Workers + D1' },
        ],
      }),
    )

    let domain: string | null = null
    let publicUrl = 'http://localhost:3000'
    if (target !== 'cloudflare') {
      const d = cancelIfAborted(
        await p.text({
          message: 'Public domain (blank = plain HTTP on :3000)',
          placeholder: 'panel.example.com',
        }),
      ).trim()
      if (d) {
        domain = d
        publicUrl = `https://${d}`
      }
    } else {
      publicUrl = cancelIfAborted(
        await p.text({
          message: 'Worker URL',
          placeholder: 'https://vpn-panel.<you>.workers.dev',
        }),
      )
    }

    const marzbanUrl = cancelIfAborted(
      await p.text({
        message: 'Marzban URL',
        placeholder: 'https://marzban.example.com',
      }),
    )
    const marzbanUser = cancelIfAborted(
      await p.text({ message: 'Marzban admin username' }),
    )
    const marzbanPass = cancelIfAborted(
      await p.password({ message: 'Marzban admin password' }),
    )

    const s = p.spinner()
    s.start('Testing Marzban login')
    const ok = await testMarzban(marzbanUrl, marzbanUser, marzbanPass)
    s.stop(ok ? 'Marzban login OK' : 'Marzban login failed')
    if (!ok) {
      const cont = cancelIfAborted(
        await p.confirm({ message: 'Continue anyway?', initialValue: false }),
      )
      if (!cont) return p.cancel('Fix the Marzban credentials and re-run.')
    }

    const subPrefix = cancelIfAborted(
      await p.text({
        message: 'Public subscription URL prefix (optional)',
        placeholder: marzbanUrl,
        defaultValue: '',
      }),
    )
    const adminEmail = cancelIfAborted(await p.text({ message: 'Admin email' }))
    const adminPass = cancelIfAborted(
      await p.password({
        message: 'Admin password (min 12 chars)',
        validate: (v) =>
          (v ?? '').length < 12 ? 'Use at least 12 characters' : undefined,
      }),
    )

    const env = {
      BETTER_AUTH_SECRET: randomSecret(),
      BETTER_AUTH_URL: publicUrl,
      BOOTSTRAP_ADMIN_EMAIL: adminEmail,
      MARZBAN_BASE_URL: marzbanUrl,
      MARZBAN_USERNAME: marzbanUser,
      MARZBAN_PASSWORD: marzbanPass,
      MARZBAN_WEBHOOK_SECRET: randomSecret(24),
      MARZBAN_SUBSCRIPTION_URL_PREFIX: subPrefix,
      ...(target === 'bun' ? { DATABASE_PATH: './data/panel.db' } : {}),
    }

    if (target === 'cloudflare') {
      writeFileSync('.dev.vars', serializeEnv(env), { mode: 0o600 })
      p.log.step('Wrote .dev.vars. Next:')
      p.note(
        [
          'wrangler d1 create vpn-panel-db',
          'cp wrangler.example.jsonc wrangler.jsonc  # paste the database_id',
          'wrangler d1 migrations apply DB --remote',
          'bun run deploy',
          ...Object.keys(env).map((k) => `wrangler secret put ${k}`),
          'bun run cli create-admin  # or use /login bootstrap',
        ].join('\n'),
        'Cloudflare steps',
      )
    } else {
      writeFileSync('.env', serializeEnv(env), { mode: 0o600 })
      p.log.success('Wrote .env (mode 600)')
      if (target === 'docker') {
        writeFileSync('docker-compose.yml', composeFile(domain))
        p.log.success('Wrote docker-compose.yml')
        const go = cancelIfAborted(
          await p.confirm({
            message: 'Build and start now?',
            initialValue: true,
          }),
        )
        if (go) {
          sh('docker', ['compose', 'up', '-d', '--build'])
          sh('docker', [
            'compose',
            'run',
            '--rm',
            'panel',
            'bun',
            'run',
            'cli',
            'create-admin',
            '--email',
            adminEmail,
            '--password',
            adminPass,
          ])
        } else {
          p.log.info(
            `Later: docker compose up -d --build && docker compose run --rm panel bun run cli create-admin --email ${adminEmail}`,
          )
        }
      } else {
        sh('bun', ['run', 'cli', 'migrate'])
        sh('bun', [
          'run',
          'cli',
          'create-admin',
          '--email',
          adminEmail,
          '--password',
          adminPass,
        ])
        p.log.info('Build & run: bun run build && bun run start')
      }
    }

    p.note(
      `MARZBAN_WEBHOOK_SECRET is stored in your env.\nAdd to Marzban .env:\n  WEBHOOK_ADDRESS = "${publicUrl}/api/webhooks/marzban"\n  WEBHOOK_SECRET = "${env.MARZBAN_WEBHOOK_SECRET}"`,
      'Marzban webhook',
    )
    p.outro('Done. Run `bun run cli doctor` anytime to verify.')
  },
})
