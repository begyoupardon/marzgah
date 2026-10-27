import { BackendError } from '#/lib/backends/types'
import type {
  BackendHealth,
  BackendInfo,
  BackendUser,
  CreateUserInput,
  ListUsersParams,
  UpdateUserInput,
  VpnBackend,
} from '#/lib/backends/types'

type Stored = BackendUser & { subscriptionToken: number; hasPassword: boolean }

/** In-memory VpnBackend for tests: no network, deterministic, records calls. */
export class FakeBackend implements VpnBackend {
  readonly id = 'fake'
  readonly calls: Array<{ method: string; args: unknown[] }> = []
  /** Set to make the next call of that method throw. */
  failNext = new Map<string, Error>()
  private users = new Map<string, Stored>()
  private counter = 0

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args })
    const failure = this.failNext.get(method)
    if (failure) {
      this.failNext.delete(method)
      throw failure
    }
  }

  private view(u: Stored): BackendUser {
    const { subscriptionToken: _t, hasPassword: _p, ...user } = u
    return { ...user, expireAt: u.expireAt ? new Date(u.expireAt) : null }
  }

  private must(username: string) {
    const u = this.users.get(username)
    if (!u) throw new BackendError('User not found', 'NOT_FOUND', 404)
    return u
  }

  info(): BackendInfo {
    return {
      id: this.id,
      label: 'Fake',
      baseUrl: 'memory://fake',
      configured: true,
    }
  }

  async getUser(username: string, options?: { repair?: boolean }) {
    this.record('getUser', username, options)
    return this.view(this.must(username))
  }

  async listUsers(params: ListUsersParams = {}) {
    this.record('listUsers', params)
    let all = [...this.users.values()]
    if (params.username)
      all = all.filter((u) => u.username.includes(params.username!))
    if (params.status) all = all.filter((u) => u.status === params.status)
    const offset = params.offset ?? 0
    const limit = params.limit ?? 100
    return {
      users: all.slice(offset, offset + limit).map((u) => this.view(u)),
      total: all.length,
    }
  }

  async createUser(input: CreateUserInput) {
    this.record('createUser', input)
    if (this.users.has(input.username))
      throw new BackendError('User already exists', 'CONFLICT', 409)
    const stored: Stored = {
      username: input.username,
      status: 'active',
      usedBytes: 0,
      dataLimitBytes: input.dataLimitBytes || null,
      expireAt: input.expireAt,
      note: input.note ?? null,
      subscriptionToken: ++this.counter,
      subscriptionUrl: '',
      hasPassword: Boolean(
        input.protocols &&
        ('trojan' in input.protocols || 'shadowsocks' in input.protocols),
      ),
    }
    stored.subscriptionUrl = `/sub/fake-${stored.subscriptionToken}`
    this.users.set(input.username, stored)
    return this.view(stored)
  }

  async updateUser(username: string, patch: UpdateUserInput) {
    this.record('updateUser', username, patch)
    const u = this.must(username)
    if (patch.password !== undefined && !u.hasPassword) {
      throw new BackendError(
        'This account has no password-based protocol',
        'UNSUPPORTED',
      )
    }
    if (patch.status !== undefined) u.status = patch.status
    if (patch.dataLimitBytes !== undefined)
      u.dataLimitBytes = patch.dataLimitBytes || null
    if (patch.expireAt !== undefined) u.expireAt = patch.expireAt
    if (patch.note !== undefined) u.note = patch.note
    return this.view(u)
  }

  async deleteUser(username: string) {
    this.record('deleteUser', username)
    this.must(username)
    this.users.delete(username)
  }

  async resetUsage(username: string) {
    this.record('resetUsage', username)
    const u = this.must(username)
    u.usedBytes = 0
    if (u.status === 'limited') u.status = 'active'
    return this.view(u)
  }

  async revokeSubscription(username: string) {
    this.record('revokeSubscription', username)
    const u = this.must(username)
    u.subscriptionToken = ++this.counter
    u.subscriptionUrl = `/sub/fake-${u.subscriptionToken}`
    return this.view(u)
  }

  async health(): Promise<BackendHealth> {
    this.record('health')
    return {
      version: 'fake-1',
      totalUsers: this.users.size,
      activeUsers: this.users.size,
      incomingBytes: 0,
      outgoingBytes: 0,
    }
  }

  // ── test helpers ──
  addUsage(username: string, bytes: number) {
    const u = this.must(username)
    u.usedBytes += bytes
    if (u.dataLimitBytes && u.usedBytes >= u.dataLimitBytes)
      u.status = 'limited'
  }
  seed(user: Partial<BackendUser> & { username: string }) {
    const stored: Stored = {
      status: 'active',
      usedBytes: 0,
      dataLimitBytes: null,
      expireAt: null,
      note: null,
      subscriptionUrl: `/sub/fake-${++this.counter}`,
      subscriptionToken: this.counter,
      hasPassword: false,
      ...user,
    }
    this.users.set(user.username, stored)
    return this.view(stored)
  }
  callsTo(method: string) {
    return this.calls.filter((c) => c.method === method)
  }
}
