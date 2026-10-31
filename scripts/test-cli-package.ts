import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { packageDir, root } from './build-cli'

const temporary = mkdtempSync(join(tmpdir(), 'marzgah-npm-smoke-'))
// Never inherit the development panel's backend credentials or database path.
const env: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? temporary,
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  NODE_ENV: 'test',
  DATABASE_PATH: join(temporary, 'panel.db'),
  BETTER_AUTH_SECRET: 'package-smoke-test-secret-'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:3000',
  NPM_CONFIG_CACHE: join(temporary, 'npm-cache'),
  BUN_INSTALL_CACHE_DIR: join(temporary, 'bun-cache'),
}
function run(command: string[], cwd: string, expected = 0) {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = result.stdout.toString() + result.stderr.toString()
  assert.equal(
    result.exitCode,
    expected,
    `${command.slice(0, 3).join(' ')} failed:\n${output}`,
  )
  return { stdout: result.stdout.toString(), output }
}
function countUsers() {
  const db = new Database(env.DATABASE_PATH, { readonly: true })
  try {
    return (
      db.query('SELECT count(*) AS count FROM user').get() as { count: number }
    ).count
  } finally {
    db.close()
  }
}
try {
  run([process.execPath, join(root, 'scripts/check-cli-release.ts')], root)
  const packed = JSON.parse(
    run(
      [
        'npm',
        'pack',
        packageDir,
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        temporary,
      ],
      temporary,
    ).stdout,
  )[0]
  const tarball = join(temporary, packed.filename)
  const archive = new Bun.Archive(await Bun.file(tarball).bytes())
  const entries = await archive.files()
  for (const name of entries.keys()) {
    assert.match(
      name,
      /^package\/(package\.json|README\.md|dist\/|migrations\/|templates\/)/,
    )
    assert.ok(
      !name.endsWith('.map'),
      'Do not ship source maps with workstation paths',
    )
  }
  const manifest = JSON.parse(await entries.get('package/package.json')!.text())
  assert.equal(
    manifest.repository.url,
    'git+https://github.com/begyoupardon/marzgah.git',
  )
  assert.equal(
    manifest.gitHead,
    undefined,
    'Do not embed a development checkout commit in the package',
  )
  writeFileSync(join(temporary, 'package.json'), '{"private":true}\n')
  run([process.execPath, 'add', tarball], temporary)
  const cli = join(temporary, 'node_modules', manifest.name, 'dist/index.js')
  const bin = join(temporary, 'node_modules/.bin/marzgah')
  assert.ok(run([bin, '--help'], temporary).output.includes('create-admin'))
  assert.ok(run([bin, '--help'], temporary).output.includes('upgrade'))
  assert.equal(
    run([bin, '--version'], temporary).stdout.trim(),
    manifest.version,
  )
  assert.ok(
    run([bin, 'init', '--help'], temporary).output.includes('scaffold-only'),
  )
  const project = join(temporary, 'new-panel')
  run([bin, 'init', project, '--scaffold-only'], temporary)
  // Check real content, including binary fonts, not just archive entry names.
  const templateFiles = await new Bun.Archive(
    await entries.get('package/templates/panel.tar.gz')!.arrayBuffer(),
  ).files()
  for (const [name, file] of templateFiles) {
    assert.ok(file.size > 0, `Empty template entry: ${name}`)
    const extracted = await Bun.file(join(project, name)).bytes()
    assert.deepEqual(
      extracted,
      await file.bytes(),
      `Extraction changed ${name}`,
    )
    if (name !== 'package.json' && name !== 'README.md') {
      if (name === '.marzgah-version') {
        assert.equal(
          new TextDecoder().decode(extracted).trim(),
          manifest.version,
        )
      } else {
        assert.deepEqual(
          extracted,
          await Bun.file(join(root, name)).bytes(),
          `Template does not match source: ${name}`,
        )
      }
    }
  }
  const gzip = await Bun.file(
    join(packageDir, 'templates/panel.tar.gz'),
  ).bytes()
  assert.equal(gzip[0], 0x1f)
  assert.equal(gzip[1], 0x8b)
  assert.ok(existsSync(join(project, 'src/routes/__root.tsx')))
  assert.ok(existsSync(join(project, '.marzgah-version')))
  assert.ok(existsSync(join(project, 'public/licenses/Arad-OFL.txt')))
  assert.ok(existsSync(join(project, 'drizzle/meta/_journal.json')))
  assert.ok(!existsSync(join(project, '.env')))
  assert.ok(!existsSync(join(project, '.git')))
  assert.ok(!existsSync(join(project, 'data')))
  const projectManifest = readFileSync(join(project, 'package.json'), 'utf8')
  assert.equal(JSON.parse(projectManifest).private, true)
  assert.ok(
    run([bin, 'upgrade', '--yes'], project).output.includes('already has'),
  )
  run([process.execPath, 'install', '--frozen-lockfile'], project)
  assert.ok(
    existsSync(
      join(project, 'node_modules/@tanstack/react-start/package.json'),
    ),
  )
  run([bin, 'migrate'], project)
  writeFileSync(join(project, '.marzgah-version'), '0.0.0-test\n')
  const upgraded = run([bin, 'upgrade', '--yes'], project)
  assert.ok(upgraded.output.includes('Panel files upgraded'))
  assert.equal(
    readFileSync(join(project, '.marzgah-version'), 'utf8').trim(),
    manifest.version,
  )
  assert.ok(existsSync(join(project, '.marzgah-backups')))
  run([bin, 'init', project, '--scaffold-only'], temporary, 1)
  assert.equal(
    readFileSync(join(project, 'package.json'), 'utf8'),
    projectManifest,
  )
  run([process.execPath, cli, 'migrate'], temporary)
  const credentials = [
    '--email',
    'package-test@example.invalid',
    '--password',
    'test-only-password-123',
  ]
  run([bin, 'create-admin', ...credentials], temporary)
  assert.equal(countUsers(), 1)
  run(
    [
      bin,
      'reset-password',
      '--email',
      'package-test@example.invalid',
      '--password',
      'replacement-test-password',
    ],
    temporary,
  )
  const backup = join(temporary, 'backup/panel.db')
  run([bin, 'backup', '--out', backup], temporary)
  run(
    [
      bin,
      'create-admin',
      '--email',
      'second@example.invalid',
      '--password',
      'test-only-password-123',
    ],
    temporary,
  )
  assert.equal(countUsers(), 2)
  run([bin, 'restore', backup], temporary)
  assert.equal(countUsers(), 1)
  assert.ok(
    run([bin, 'doctor'], temporary, 1).output.includes('missing credentials'),
  )
  // Test release identity checks in a disposable repository without contacting GitHub.
  const release = join(temporary, 'release-checkout')
  mkdirSync(join(release, 'scripts'), { recursive: true })
  mkdirSync(join(release, 'empty-hooks'))
  cpSync(
    join(root, 'scripts/check-cli-release.ts'),
    join(release, 'scripts/check-cli-release.ts'),
  )
  cpSync(packageDir, join(release, 'packages/cli'), { recursive: true })
  const guard = [
    process.execPath,
    join(release, 'scripts/check-cli-release.ts'),
    '--publish',
  ]
  run(['git', 'init', '-b', 'main'], release)
  run(['git', 'config', 'user.name', 'Marzgah'], release)
  run(
    ['git', 'config', 'user.email', 'begyoupardon@users.noreply.github.com'],
    release,
  )
  run(['git', 'config', 'commit.gpgsign', 'false'], release)
  run(
    ['git', 'config', 'core.hooksPath', join(release, 'empty-hooks')],
    release,
  )
  run(
    [
      'git',
      'remote',
      'add',
      'origin',
      'https://github.com/begyoupardon/marzgah.git',
    ],
    release,
  )
  run(['git', 'add', '.'], release)
  run(['git', 'commit', '-m', 'Release fixture'], release)
  run(guard, release)
  run(
    [
      'git',
      'remote',
      'set-url',
      'origin',
      'https://github.com/unrelated-owner/project.git',
    ],
    release,
  )
  assert.ok(run(guard, release, 1).output.includes('restricted'))
  run(
    [
      'git',
      'remote',
      'set-url',
      'origin',
      'https://github.com/begyoupardon/marzgah.git',
    ],
    release,
  )
  run(
    [
      'git',
      'commit',
      '--allow-empty',
      '--author',
      'Another identity <other@example.invalid>',
      '-m',
      'Identity fixture',
    ],
    release,
  )
  assert.ok(run(guard, release, 1).output.includes('unapproved'))
  console.log(
    `Packed archive smoke test passed: ${manifest.name}@${manifest.version}`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
