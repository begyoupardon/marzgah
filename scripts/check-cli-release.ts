import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, 'packages/cli')
const pkg = await Bun.file(join(dir, 'package.json')).json()
for (const file of [
  'dist/index.js',
  'migrations/meta/_journal.json',
  'templates/panel.tar.gz',
]) {
  if (!existsSync(join(dir, file)))
    throw new Error(`Missing ${file}; run bun run build:cli first.`)
}
const archive = new Bun.Archive(
  await Bun.file(join(dir, 'templates/panel.tar.gz')).bytes(),
)
for (const path of (await archive.files()).keys()) {
  if (
    path.startsWith('/') ||
    path
      .split('/')
      .some((part) =>
        [
          '..',
          '.git',
          'node_modules',
          'data',
          'backups',
          '.aws',
          '.codex',
          '.agents',
        ].includes(part),
      )
  )
    throw new Error(`Disallowed template path: ${path}`)
  if (/(^|\/)\.env($|\.)/.test(path) && path !== '.env.example')
    throw new Error(`Environment file in template: ${path}`)
  if (/\.(db|sqlite|sqlite3|pem|key|tgz)$/.test(path))
    throw new Error(`Private/runtime file in template: ${path}`)
}
if (
  pkg.repository.url !== 'git+https://github.com/begyoupardon/marzgah.git' ||
  pkg.private === true
)
  throw new Error('CLI package metadata is not configured for release.')
console.log(`${pkg.name}@${pkg.version}: release assets checked`)

if (process.argv.includes('--publish')) {
  const expected = 'begyoupardon/marzgah'
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (result.exitCode !== 0)
      throw new Error('Publish from the reviewed release Git repository.')
    return result.stdout.toString().trim()
  }
  const remote = git('remote', 'get-url', 'origin').replace(/\.git$/, '')
  if (
    !remote.endsWith(`github.com/${expected}`) &&
    !/^git@[^:]+:begyoupardon\/marzgah$/.test(remote)
  ) {
    throw new Error(
      `Publishing is restricted to ${expected}. This checkout still uses another origin.`,
    )
  }
  const allowed = new Set([
    'begyoupardon@users.noreply.github.com',
    'noreply@github.com',
    ...(process.env.RELEASE_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ])
  const emails = git('log', '--all', '--format=%ae%n%ce').split('\n')
  if (
    emails.some(
      (email) =>
        !allowed.has(email.toLowerCase()) &&
        !/^(?:\d+\+)?(?:begyoupardon|github-actions\[bot\]|dependabot\[bot\])@users\.noreply\.github\.com$/i.test(
          email,
        ),
    )
  ) {
    throw new Error(
      'Git history contains unapproved author/committer identities. Publish from a fresh, reviewed release history, or explicitly approve additional identities with RELEASE_ALLOWED_EMAILS.',
    )
  }
  if (
    process.env.GITHUB_REF_TYPE === 'tag' &&
    process.env.GITHUB_REF_NAME !== `cli-v${pkg.version}`
  ) {
    throw new Error('Release tag must match the CLI package version.')
  }
  const dirty = git('status', '--porcelain')
  if (dirty)
    throw new Error('Commit the reviewed release changes before publishing.')
  console.log('Release repository, history, tag and working tree checked')
}
