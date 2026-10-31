import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

import * as p from '@clack/prompts'
import { defineCommand } from 'citty'

import { backupDatabase } from '../../src/lib/backup.ts'
import { databasePath, loadEnvFile } from '../lib.ts'
import { packagedAsset } from '../paths.ts'
import { isPanelProject } from '../scaffold.ts'

const preservedNames = new Set([
  '.env',
  '.dev.vars',
  'data',
  'node_modules',
  '.git',
  'backups',
  'docker-compose.yml',
  'wrangler.jsonc',
  '.marzgah-backups',
])

function isPreserved(path: string) {
  return path.split(sep).some((part) => preservedNames.has(part))
}

function listAppFiles(directory: string, prefix = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(directory)) {
    const relativePath = prefix ? `${prefix}/${name}` : name
    if (isPreserved(relativePath)) continue
    const path = join(directory, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`)
    if (stat.isDirectory()) files.push(...listAppFiles(path, relativePath))
    else if (stat.isFile()) files.push(relativePath)
  }
  return files
}

function copyAppFiles(source: string, target: string) {
  for (const path of listAppFiles(source)) {
    const from = join(source, path)
    const to = join(target, path)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { force: true })
  }
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed (exit ${result.status ?? 'unknown'}).`,
    )
}

function versionFrom(path: string) {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

export default defineCommand({
  meta: { name: 'upgrade', description: 'Back up and upgrade this panel' },
  args: {
    yes: {
      type: 'boolean',
      description: 'Confirm replacing app files',
      default: false,
    },
  },
  async run({ args }) {
    const project = resolve(process.cwd())
    if (!isPanelProject(project))
      throw new Error(
        'Run upgrade from the root of an initialized Marzgah project.',
      )

    loadEnvFile()
    const cliManifest = JSON.parse(
      readFileSync(packagedAsset('package.json'), 'utf8'),
    ) as {
      version: string
    }
    const targetVersion = cliManifest.version
    const oldVersion = versionFrom(join(project, '.marzgah-version'))
    if (oldVersion === targetVersion) {
      p.log.info(`This project already has the ${targetVersion} template.`)
      return
    }

    const legacyNotice = oldVersion
      ? `Update template ${oldVersion} → ${targetVersion}.`
      : `Update this older project to template ${targetVersion}. Its app source will be replaced; .env, database, Docker Compose, and Wrangler config are preserved.`
    if (!args.yes) {
      const proceed = await p.confirm({ message: `${legacyNotice} Continue?` })
      if (p.isCancel(proceed) || !proceed) return p.cancel('Upgrade cancelled.')
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(project, '.marzgah-backups', `upgrade-${stamp}`)
    const appBackup = join(backupRoot, 'app')
    const dbBackup = join(backupRoot, 'panel.db')
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
    mkdirSync(appBackup, { recursive: true, mode: 0o700 })
    const temp = mkdtempSync(join(tmpdir(), 'marzgah-upgrade-'))
    let templateFiles: string[] = []

    try {
      await backupDatabase(databasePath(), dbBackup)
      chmodSync(dbBackup, 0o600)
      copyAppFiles(project, appBackup)

      const archive = new Bun.Archive(
        await Bun.file(packagedAsset('templates/panel.tar.gz')).bytes(),
      )
      await archive.extract(temp)
      templateFiles = listAppFiles(temp)
      templateFiles.push('.marzgah-version')
      if (
        !templateFiles.includes('package.json') ||
        !templateFiles.includes('src/db/schema.ts')
      )
        throw new Error('The published project template is incomplete.')

      copyAppFiles(temp, project)
      writeFileSync(join(project, '.marzgah-version'), `${targetVersion}\n`, {
        mode: 0o600,
      })

      run(process.execPath, ['install', '--frozen-lockfile'])
      run(process.execPath, ['run', 'cli', 'migrate'])
      run(process.execPath, ['run', 'build'])

      p.log.success(`Panel files upgraded to ${targetVersion}.`)
      p.note(
        `Database backup: ${dbBackup}\nApp-file backup: ${appBackup}\n\nRestart your panel service to load the new build.`,
        'Upgrade complete',
      )
    } catch (error) {
      // Restore the previous app files. The additive database migration is safe
      // for the previous app version; retain its backup for manual recovery.
      for (const path of templateFiles) {
        if (!isPreserved(path))
          rmSync(join(project, path), { recursive: true, force: true })
      }
      if (existsSync(appBackup)) copyAppFiles(appBackup, project)
      p.log.error(
        `Upgrade failed. Previous app files were restored. Backups: ${backupRoot}`,
      )
      try {
        run(process.execPath, ['install', '--frozen-lockfile'])
      } catch {
        p.log.warn(
          'Could not restore dependencies automatically. Run bun install --frozen-lockfile before restarting.',
        )
      }
      throw error
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  },
})
