import { resolveSubscriptionUrl } from './subscription-url'
import * as z from 'zod'

import { getEnv } from '#/lib/env'
import {
  marzbanCreateUserSchema,
  marzbanInboundsSchema,
  marzbanModifyUserSchema,
  marzbanSystemStatsSchema,
  marzbanUserResponseSchema,
  marzbanUsersResponseSchema,
} from './types.ts'
import type {
  MarzbanCreateUserInput,
  MarzbanModifyUserInput,
  MarzbanUserResponse,
} from './types.ts'
import { buildInboundsForProxies } from './inbounds.ts'

export class MarzbanApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'MarzbanApiError'
  }
}

type TokenCache = {
  accessToken: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null
let pendingToken: Promise<string> | null = null

function getConfig() {
  const env = getEnv()
  const baseUrl = env.MARZBAN_BASE_URL
  const username = env.MARZBAN_USERNAME
  const password = env.MARZBAN_PASSWORD

  if (!baseUrl || !username || !password) {
    throw new MarzbanApiError(
      'Marzban is not configured. Set MARZBAN_BASE_URL, MARZBAN_USERNAME, and MARZBAN_PASSWORD.',
      500,
    )
  }

  return { baseUrl, username, password }
}

async function fetchToken(force = false): Promise<string> {
  const now = Date.now()
  if (!force && tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken
  }

  if (pendingToken) return pendingToken
  pendingToken = requestToken(now)
  try {
    return await pendingToken
  } finally {
    pendingToken = null
  }
}

async function requestToken(now: number): Promise<string> {
  const { baseUrl, username, password } = getConfig()
  const body = new URLSearchParams({
    username,
    password,
    grant_type: 'password',
  })

  const res = await fetch(`${baseUrl}/api/admin/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  if (!res.ok) {
    throw new MarzbanApiError(
      `Marzban auth failed (${res.status})`,
      res.status,
      await safeJson(res),
    )
  }

  const json = z
    .object({
      access_token: z.string(),
      token_type: z.string().optional(),
    })
    .parse(await res.json())

  // Marzban JWTs are typically long-lived; refresh hourly by default.
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + 55 * 60_000,
  }

  return json.access_token
}

async function safeJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  parse: (data: unknown) => T,
  retried = false,
): Promise<T> {
  const { baseUrl } = getConfig()
  const token = await fetchToken(retried)

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (res.status === 401 && !retried) {
    tokenCache = null
    return request(path, init, parse, true)
  }

  if (res.status === 204) {
    return parse(null)
  }

  const data = await safeJson(res)

  if (!res.ok) {
    const detail =
      typeof data === 'object' &&
      data &&
      'detail' in data &&
      typeof data.detail === 'string'
        ? (data as { detail: string }).detail
        : `Marzban request failed (${res.status})`
    throw new MarzbanApiError(detail, res.status, data)
  }

  return parse(data)
}

export const marzban = {
  async getUser(username: string): Promise<MarzbanUserResponse> {
    return request(
      `/api/user/${encodeURIComponent(username)}`,
      { method: 'GET' },
      (data) => marzbanUserResponseSchema.parse(data),
    )
  },

  async listUsers(params?: {
    offset?: number
    limit?: number
    username?: string
    status?: string
  }) {
    const search = new URLSearchParams()
    if (params?.offset != null) search.set('offset', String(params.offset))
    if (params?.limit != null) search.set('limit', String(params.limit))
    if (params?.username) search.set('username', params.username)
    if (params?.status) search.set('status', params.status)
    const qs = search.toString()

    return request(
      `/api/users${qs ? `?${qs}` : ''}`,
      { method: 'GET' },
      (data) => marzbanUsersResponseSchema.parse(data),
    )
  },

  async createUser(input: MarzbanCreateUserInput) {
    const body = marzbanCreateUserSchema.parse(input)
    // This Marzban build stores empty inbounds when the field is omitted,
    // which produces a valid /sub URL with an empty body. Always attach tags.
    const inboundValues = body.inbounds ? Object.values(body.inbounds) : []
    const missingInbounds =
      !body.inbounds || inboundValues.every((tags) => tags.length === 0)
    if (missingInbounds) {
      const catalog = await this.getInbounds()
      body.inbounds = buildInboundsForProxies(body.proxies, catalog)
    }
    return request(
      '/api/user',
      { method: 'POST', body: JSON.stringify(body) },
      (data) => marzbanUserResponseSchema.parse(data),
    )
  },

  async modifyUser(username: string, input: MarzbanModifyUserInput) {
    const body = marzbanModifyUserSchema.parse(input)
    return request(
      `/api/user/${encodeURIComponent(username)}`,
      { method: 'PUT', body: JSON.stringify(body) },
      (data) => marzbanUserResponseSchema.parse(data),
    )
  },

  async deleteUser(username: string) {
    return request(
      `/api/user/${encodeURIComponent(username)}`,
      { method: 'DELETE' },
      () => undefined,
    )
  },

  async resetUserDataUsage(username: string) {
    return request(
      `/api/user/${encodeURIComponent(username)}/reset`,
      { method: 'POST' },
      (data) => marzbanUserResponseSchema.parse(data),
    )
  },

  async revokeUserSubscription(username: string) {
    return request(
      `/api/user/${encodeURIComponent(username)}/revoke_sub`,
      { method: 'POST' },
      (data) => marzbanUserResponseSchema.parse(data),
    )
  },

  async getInbounds() {
    return request('/api/inbounds', { method: 'GET' }, (data) =>
      marzbanInboundsSchema.parse(data),
    )
  },

  async getHosts() {
    return request('/api/hosts', { method: 'GET' }, (data) =>
      z
        .record(
          z.string(),
          z.array(
            z
              .object({
                address: z.string(),
                remark: z.string().default(''),
                port: z.number().nullable().optional(),
                is_disabled: z.boolean().nullable().optional(),
              })
              .passthrough(),
          ),
        )
        .parse(data),
    )
  },

  async getSubscription(username: string, format: string) {
    const user = await this.getUser(username)
    const env = getEnv()
    const base = env.MARZBAN_SUBSCRIPTION_URL_PREFIX ?? env.MARZBAN_BASE_URL
    if (!base) throw new Error('Subscription server is not configured')
    const url = new URL(
      resolveSubscriptionUrl(user.subscription_url) ?? '',
      (base.includes('://') ? base : `https://${base}`) + '/',
    )
    const origins = [env.MARZBAN_BASE_URL, env.MARZBAN_SUBSCRIPTION_URL_PREFIX]
      .filter(Boolean)
      .map(
        (value) =>
          new URL(value!.includes('://') ? value! : `https://${value}`).origin,
      )
    if (
      !origins.includes(url.origin) ||
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Subscription server address is not permitted')
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${format}`
    url.search = ''
    url.hash = ''
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json, text/plain, text/yaml' },
    })
    if (!response.ok) throw new Error('Subscription is temporarily unavailable')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Subscription is empty')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.length
        if (length > 5_000_000) throw new Error('Subscription is too large')
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel()
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return {
      body: new TextDecoder().decode(bytes),
      contentType: response.headers.get('content-type') ?? 'text/plain',
    }
  },

  async getSystemStats() {
    return request('/api/system', { method: 'GET' }, (data) =>
      marzbanSystemStatsSchema.parse(data),
    )
  },

  clearTokenCache() {
    tokenCache = null
  },
}
