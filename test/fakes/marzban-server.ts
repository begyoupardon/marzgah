type MUser = {
  username: string
  status: string
  used_traffic: number
  data_limit: number | null
  expire: number | null
  note: string | null
  proxies: Record<string, unknown>
  inbounds: Record<string, string[]>
  links: string[]
  sub: number
}

/**
 * A tiny Marzban API emulation, enough for the real client + adapter to run
 * against. Mirrors the status codes and shapes the real server returns.
 */
export function createFakeMarzbanServer() {
  const users = new Map<string, MUser>()
  let subCounter = 0
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  const view = (u: MUser) => ({
    username: u.username,
    status: u.status,
    used_traffic: u.used_traffic,
    data_limit: u.data_limit,
    expire: u.expire,
    note: u.note,
    proxies: u.proxies,
    inbounds: u.inbounds,
    links: u.links,
    subscription_url: `https://sub.example.com/sub/t${u.sub}`,
  })
  const missing = () => json({ detail: 'User not found' }, 404)

  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = (init.method ?? 'GET').toUpperCase()
    const path = url.pathname
    const body =
      typeof init.body === 'string' && init.body.startsWith('{')
        ? JSON.parse(init.body)
        : undefined

    if (path === '/api/admin/token')
      return json({ access_token: 'tok', token_type: 'bearer' })
    if (!new Headers(init.headers).get('authorization')?.startsWith('Bearer '))
      return json({ detail: 'Not authenticated' }, 401)

    if (path === '/api/inbounds') {
      return json({
        vless: [{ tag: 'VLESS TCP', protocol: 'vless', network: 'tcp' }],
        trojan: [{ tag: 'TROJAN', protocol: 'trojan' }],
      })
    }
    if (path === '/api/system') {
      return json({
        version: '0.8.4',
        total_user: users.size,
        users_active: users.size,
        incoming_bandwidth: 10,
        outgoing_bandwidth: 20,
      })
    }
    if (path === '/api/users' && method === 'GET') {
      let all = [...users.values()]
      const q = url.searchParams.get('username')
      const status = url.searchParams.get('status')
      if (q) all = all.filter((u) => u.username.includes(q))
      if (status) all = all.filter((u) => u.status === status)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 100)
      return json({
        users: all.slice(offset, offset + limit).map(view),
        total: all.length,
      })
    }
    if (path === '/api/user' && method === 'POST') {
      if (users.has(body.username))
        return json({ detail: 'User already exists' }, 409)
      const inbounds = body.inbounds ?? {}
      const user: MUser = {
        username: body.username,
        status: body.status ?? 'active',
        used_traffic: 0,
        data_limit: body.data_limit ?? null,
        expire: body.expire ?? null,
        note: body.note ?? null,
        proxies: body.proxies ?? {},
        inbounds,
        links: Object.keys(inbounds).length ? ['vless://x'] : [],
        sub: ++subCounter,
      }
      users.set(user.username, user)
      return json(view(user))
    }

    const match = /^\/api\/user\/([^/]+)(\/reset|\/revoke_sub)?$/.exec(path)
    if (!match) return json({ detail: 'Not found' }, 404)
    const name = decodeURIComponent(match[1])
    const u = users.get(name)
    if (!u) return missing()
    if (match[2] === '/reset' && method === 'POST') {
      u.used_traffic = 0
      if (u.status === 'limited') u.status = 'active'
      return json(view(u))
    }
    if (match[2] === '/revoke_sub' && method === 'POST') {
      u.sub = ++subCounter
      return json(view(u))
    }
    if (method === 'GET') return json(view(u))
    if (method === 'DELETE') {
      users.delete(name)
      return json({})
    }
    if (method === 'PUT') {
      for (const key of [
        'status',
        'data_limit',
        'expire',
        'note',
        'proxies',
        'inbounds',
      ] as const) {
        if (key in body) (u as Record<string, unknown>)[key] = body[key]
      }
      if (u.inbounds && Object.keys(u.inbounds).length) u.links = ['vless://x']
      return json(view(u))
    }
    return json({ detail: 'Not found' }, 404)
  }) as unknown as typeof fetch

  return {
    fetch: fetchImpl,
    addUsage(username: string, bytes: number) {
      const u = users.get(username)
      if (!u) throw new Error('no such user')
      u.used_traffic += bytes
      if (u.data_limit && u.used_traffic >= u.data_limit) u.status = 'limited'
    },
    /** Insert a user created "outside" the panel, e.g. without inbound tags. */
    seed(partial: Partial<MUser> & { username: string }) {
      const user: MUser = {
        status: 'active',
        used_traffic: 0,
        data_limit: null,
        expire: null,
        note: null,
        proxies: {},
        inbounds: {},
        links: [],
        sub: ++subCounter,
        ...partial,
      }
      users.set(user.username, user)
    },
    raw: (username: string) => users.get(username),
    size: () => users.size,
  }
}
