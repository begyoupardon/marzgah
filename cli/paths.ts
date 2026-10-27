import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The bundled entrypoint is dist/index.js; source checkout paths stay unchanged. */
export function packagedAsset(relativePath: string): string {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url))
}

export function configureMigrationPath() {
  const bundled = packagedAsset('migrations')
  if (!process.env.MIGRATIONS_DIR && existsSync(bundled)) {
    process.env.MIGRATIONS_DIR = bundled
  }
}
