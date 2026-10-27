import { createMarzbanBackend } from './marzban'
import type { VpnBackend } from './types'

export const DEFAULT_BACKEND_ID = 'marzban'

const factories: Record<string, () => VpnBackend> = {
  marzban: createMarzbanBackend,
}
const cache = new Map<string, VpnBackend>()

/**
 * The backend for a stored id (vpn_users.backend). Unknown ids fail loudly
 * rather than silently talking to the wrong server.
 */
export function getBackend(id: string = DEFAULT_BACKEND_ID): VpnBackend {
  const cached = cache.get(id)
  if (cached) return cached
  const make = factories[id]
  if (!make) throw new Error(`Unknown VPN backend "${id}"`)
  const backend = make()
  cache.set(id, backend)
  return backend
}

/** Tests (and future plug-ins) can install an implementation. */
export function setBackend(id: string, backend: VpnBackend) {
  cache.set(id, backend)
}

export function resetBackends() {
  cache.clear()
}

export function registerBackendFactory(id: string, make: () => VpnBackend) {
  factories[id] = make
  cache.delete(id)
}
