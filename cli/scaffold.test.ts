import { afterAll, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isPanelProject, scaffoldProject } from './scaffold'

const temporary = mkdtempSync(join(tmpdir(), 'marzgah-scaffold-test-'))
afterAll(() => rmSync(temporary, { recursive: true, force: true }))
const archive = join(temporary, 'panel.tar.gz')
await Bun.write(
  archive,
  new Bun.Archive(
    {
      'package.json': JSON.stringify({
        name: 'renamed-panel',
        scripts: { cli: 'bun run cli/index.ts' },
        private: true,
      }),
      'cli/index.ts': '// CLI',
      'src/db/schema.ts': '// schema',
    },
    { compress: 'gzip' },
  ),
)

test('scaffolds a complete project without installing dependencies or creating credentials', async () => {
  const target = join(temporary, 'new-panel')
  expect(await scaffoldProject(target, archive)).toBe(target)
  expect(isPanelProject(target)).toBe(true)
  expect(existsSync(join(target, '.env'))).toBe(false)
  expect(existsSync(join(target, 'node_modules'))).toBe(false)
})
test('refuses to overwrite an existing directory', async () => {
  const target = join(temporary, 'existing')
  mkdirSync(target)
  writeFileSync(join(target, 'keep.txt'), 'keep me')
  await expect(scaffoldProject(target, archive)).rejects.toThrow('not empty')
  expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep me')
})
test('rolls back incomplete extraction and preserves an originally empty directory', async () => {
  const invalid = join(temporary, 'incomplete.tar.gz')
  await Bun.write(invalid, new Bun.Archive({ 'incomplete.txt': 'partial' }))
  const target = join(temporary, 'empty')
  mkdirSync(target)
  await expect(scaffoldProject(target, invalid)).rejects.toThrow('incomplete')
  expect(readdirSync(target)).toEqual([])
})
test('refuses a symlink destination', async () => {
  const target = join(temporary, 'real-directory')
  mkdirSync(target)
  const link = join(temporary, 'linked-directory')
  symlinkSync(target, link, 'dir')
  await expect(scaffoldProject(link, archive)).rejects.toThrow('symbolic link')
  expect(readdirSync(target)).toEqual([])
})
