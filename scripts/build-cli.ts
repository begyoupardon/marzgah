import { gzipSync } from 'node:zlib'
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const packageDir = join(root, 'packages/cli')
const templateDirectories = [
  'src',
  'cli',
  'drizzle',
  'public',
  'server',
  'test',
  'docs',
]
const templateFiles = [
  '.gitignore',
  '.dockerignore',
  '.env.example',
  '.dev.vars.example',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'Dockerfile',
  'README.md',
  'package.json',
  'bun.lock',
  'bunfig.toml',
  'tsconfig.json',
  'tsr.config.json',
  'vite.config.ts',
  'drizzle.config.ts',
  'wrangler.example.jsonc',
  'worker-configuration.d.ts',
  'components.json',
]
const allowedExtensions = new Set([
  '.ts',
  '.tsx',
  '.css',
  '.svg',
  '.png',
  '.ico',
  '.woff2',
  '.json',
  '.sql',
  '.mjs',
  '.txt',
  '.md',
  '.webmanifest',
])

export async function buildCli() {
  const manifest = await Bun.file(join(packageDir, 'package.json')).json()
  if (
    manifest.repository.url !==
    'git+https://github.com/begyoupardon/marzgah.git'
  )
    throw new Error('Review the CLI repository metadata before building.')
  for (const directory of ['dist', 'migrations', 'templates']) {
    rmSync(join(packageDir, directory), { recursive: true, force: true })
    mkdirSync(join(packageDir, directory), { recursive: true })
  }
  const result = await Bun.build({
    entrypoints: [join(root, 'cli/index.ts')],
    outdir: join(packageDir, 'dist'),
    target: 'bun',
    packages: 'external',
    sourcemap: 'none',
    env: 'disable',
  })
  if (!result.success) throw new AggregateError(result.logs, 'CLI build failed')
  chmodSync(join(packageDir, 'dist/index.js'), 0o755)
  cpSync(join(root, 'drizzle'), join(packageDir, 'migrations'), {
    recursive: true,
  })

  const files: Record<string, Blob | string> = {}
  function addFile(path: string) {
    const archivePath = relative(root, path).replaceAll('\\', '/')
    if (archivePath.includes('/.') || archivePath === 'docs/npm-cli.md') return
    files[archivePath] = Bun.file(path)
  }
  function walk(directory: string) {
    for (const name of readdirSync(directory).sort()) {
      if (name.startsWith('.')) continue
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink())
        throw new Error(
          `Template symlinks are not supported: ${relative(root, path)}`,
        )
      if (stat.isDirectory()) walk(path)
      else if (allowedExtensions.has(extname(name))) addFile(path)
    }
  }
  for (const directory of templateDirectories) walk(join(root, directory))
  for (const name of templateFiles) files[name] = Bun.file(join(root, name))
  // Publishing helpers belong to the release repository, not generated applications.
  const app = await Bun.file(join(root, 'package.json')).json()
  for (const key of ['build:cli', 'test:cli-package', 'pack:cli'])
    delete app.scripts[key]
  files['package.json'] = `${JSON.stringify(app, null, 2)}\n`
  files['README.md'] = (await Bun.file(join(root, 'README.md')).text()).replace(
    /<!-- release-only-start -->[\s\S]*?<!-- release-only-end -->/g,
    '',
  )
  files['.marzgah-version'] = `${manifest.version}\n`
  // Materialize Bun.file blobs before archiving: older Bun Archive versions
  // accept Blob values in their types but can emit zero-length entries for them.
  const contents: Record<string, string | Uint8Array> = {}
  for (const [name, value] of Object.entries(files)) {
    contents[name] =
      typeof value === 'string'
        ? value
        : new Uint8Array(await value.arrayBuffer())
  }
  // gzip explicitly for compatibility across the supported Bun versions.
  const archive = await new Bun.Archive(contents).bytes()
  await Bun.write(join(packageDir, 'templates/panel.tar.gz'), gzipSync(archive))
  const inputs = Object.keys(files).sort()
  console.log(
    `Built ${manifest.name}@${manifest.version} (${inputs.length} template files)`,
  )
}

if (import.meta.main) await buildCli()
