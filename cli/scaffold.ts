import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { packagedAsset } from './paths'

export function isPanelProject(directory: string): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(directory, 'package.json'), 'utf8'),
    )
    return (
      typeof pkg.scripts?.cli === 'string' &&
      existsSync(resolve(directory, 'cli/index.ts')) &&
      existsSync(resolve(directory, 'src/db/schema.ts'))
    )
  } catch {
    return false
  }
}

/** Only scaffold into a new or empty directory. Never merge over an existing app. */
export async function scaffoldProject(
  directory: string,
  archivePath = packagedAsset('templates/panel.tar.gz'),
): Promise<string> {
  const target = resolve(directory)
  if (!existsSync(archivePath))
    throw new Error(
      'Project template is missing. Use the published Marzgah CLI or run bun run build:cli first.',
    )
  const existed = existsSync(target)
  if (existed && lstatSync(target).isSymbolicLink())
    throw new Error('Choose a directory instead of a symbolic link.')
  if (existed && readdirSync(target).length)
    throw new Error(`Directory is not empty: ${target}`)
  mkdirSync(target, { recursive: true })
  try {
    const archive = new Bun.Archive(await Bun.file(archivePath).bytes())
    await archive.extract(target)
    if (!isPanelProject(target))
      throw new Error('The project template is incomplete.')
    return target
  } catch (error) {
    // This directory was empty and contains only files from our failed extraction.
    rmSync(target, { recursive: true, force: true })
    if (existed) mkdirSync(target, { recursive: true })
    throw error
  }
}
