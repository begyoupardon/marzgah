import { vi as bunVi } from 'bun:test'

/** Bun does not hoist mocks like vitest; this just runs the factory in place. */
export function hoisted<T>(factory: () => T): T {
  return factory()
}

const envBackup = new Map<string, string | undefined>()
const globalBackup = new Map<string, unknown>()

/** vitest-compatible helpers missing from bun:test's `vi`. */
export const vi = Object.assign(bunVi, {
  stubEnv(key: string, value: string) {
    if (!envBackup.has(key)) envBackup.set(key, process.env[key])
    process.env[key] = value
  },
  unstubAllEnvs() {
    for (const [k, v] of envBackup) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    envBackup.clear()
  },
  stubGlobal(key: string, value: unknown) {
    if (!globalBackup.has(key)) {
      globalBackup.set(key, (globalThis as Record<string, unknown>)[key])
    }
    ;(globalThis as Record<string, unknown>)[key] = value
  },
  unstubAllGlobals() {
    for (const [k, v] of globalBackup) {
      ;(globalThis as Record<string, unknown>)[k] = v
    }
    globalBackup.clear()
  },
})
