import { MarzbanApiError, marzban } from '#/lib/marzban/client'
import {
  buildInboundsForProxies,
  needsInboundRepair,
} from '#/lib/marzban/inbounds'
import { applyProxyPassword } from '#/lib/marzban/proxy-password'
import type { MarzbanUserResponse } from '#/lib/marzban/types'
import { getEnv } from '#/lib/env'
import { BackendError } from './types'
import type { BackendUser, VpnBackend } from './types'

const toSeconds = (d: Date | null) =>
  d ? Math.floor(d.getTime() / 1000) : null

/** Tolerant on purpose: older Marzban builds omit fields. */
export function toBackendUser(m: MarzbanUserResponse): BackendUser {
  return {
    username: m.username,
    status: m.status ?? 'active',
    usedBytes: m.used_traffic ?? 0,
    dataLimitBytes: m.data_limit || null,
    expireAt: m.expire ? new Date(m.expire * 1000) : null,
    note: m.note ?? null,
    subscriptionUrl: m.subscription_url ?? '',
  }
}

function translate(error: unknown): never {
  if (error instanceof MarzbanApiError) {
    const code =
      error.status === 404
        ? 'NOT_FOUND'
        : error.status === 409
          ? 'CONFLICT'
          : error.status >= 400 && error.status < 500
            ? 'INVALID'
            : 'UNAVAILABLE'
    throw new BackendError(error.message, code, error.status, { cause: error })
  }
  throw error
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    return translate(error)
  }
}

export function createMarzbanBackend(): VpnBackend {
  return {
    id: 'marzban',

    info() {
      const env = getEnv()
      return {
        id: 'marzban',
        label: 'Marzban',
        baseUrl: env.MARZBAN_BASE_URL ?? null,
        configured: Boolean(
          env.MARZBAN_BASE_URL && env.MARZBAN_USERNAME && env.MARZBAN_PASSWORD,
        ),
      }
    },

    getUser(username, options) {
      return guard(async () => {
        let user = await marzban.getUser(username)
        // Heal accounts created without inbound tags (they yield an empty subscription).
        if (options?.repair !== false && needsInboundRepair(user)) {
          const catalog = await marzban.getInbounds()
          const inbounds = buildInboundsForProxies(user.proxies ?? {}, catalog)
          if (Object.keys(inbounds).length > 0) {
            user = await marzban.modifyUser(username, { inbounds })
          }
        }
        return toBackendUser(user)
      })
    },

    listUsers(params) {
      return guard(async () => {
        const result = await marzban.listUsers(params)
        return { users: result.users.map(toBackendUser), total: result.total }
      })
    },

    createUser(input) {
      return guard(async () => {
        const created = await marzban.createUser({
          username: input.username,
          proxies: input.protocols ?? { vless: {} },
          data_limit: input.dataLimitBytes,
          expire: toSeconds(input.expireAt),
          note: input.note ?? null,
          status: 'active',
          data_limit_reset_strategy: 'no_reset',
        })
        return toBackendUser(created)
      })
    },

    updateUser(username, patch) {
      return guard(async () => {
        let proxies: Record<string, unknown> | undefined
        if (patch.password !== undefined) {
          const remote = await marzban.getUser(username)
          const next = applyProxyPassword(remote.proxies ?? {}, patch.password)
          if (!next) {
            throw new BackendError(
              'This account has no password-based protocol',
              'UNSUPPORTED',
            )
          }
          proxies = next
        }
        const updated = await marzban.modifyUser(username, {
          ...(patch.dataLimitBytes !== undefined
            ? { data_limit: patch.dataLimitBytes }
            : {}),
          ...(patch.expireAt !== undefined
            ? { expire: toSeconds(patch.expireAt) }
            : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.status ? { status: patch.status } : {}),
          ...(proxies ? { proxies } : {}),
        })
        return toBackendUser(updated)
      })
    },

    deleteUser(username) {
      return guard(async () => {
        await marzban.deleteUser(username)
      })
    },

    resetUsage(username) {
      return guard(async () =>
        toBackendUser(await marzban.resetUserDataUsage(username)),
      )
    },

    revokeSubscription(username) {
      return guard(async () =>
        toBackendUser(await marzban.revokeUserSubscription(username)),
      )
    },

    health() {
      return guard(async () => {
        marzban.clearTokenCache()
        const stats = await marzban.getSystemStats()
        return {
          version: stats.version ?? null,
          totalUsers: stats.total_user ?? null,
          activeUsers: stats.users_active ?? null,
          incomingBytes: stats.incoming_bandwidth ?? null,
          outgoingBytes: stats.outgoing_bandwidth ?? null,
        }
      })
    },
  }
}
