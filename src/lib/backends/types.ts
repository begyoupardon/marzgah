export type BackendUserStatus =
  | 'active'
  | 'disabled'
  | 'limited'
  | 'expired'
  | 'on_hold'

/** A VPN account as the panel sees it, whatever software hosts it. */
export type BackendUser = {
  username: string
  status: BackendUserStatus
  usedBytes: number
  /** null = unlimited */
  dataLimitBytes: number | null
  /** null = never expires */
  expireAt: Date | null
  note: string | null
  /** As reported by the backend; may be a relative path. */
  subscriptionUrl: string
}

export type CreateUserInput = {
  username: string
  dataLimitBytes: number | null
  expireAt: Date | null
  note?: string | null
  /** Backend-specific protocol settings. Omit for the backend's default. */
  protocols?: Record<string, unknown>
}

/** Only keys that are present (not undefined) are changed. */
export type UpdateUserInput = {
  status?: 'active' | 'disabled' | 'on_hold'
  dataLimitBytes?: number | null
  expireAt?: Date | null
  note?: string | null
  /** Throws UNSUPPORTED when the account has no password-based protocol. */
  password?: string
}

export type ListUsersParams = {
  offset?: number
  limit?: number
  /** Substring match. */
  username?: string
  status?: BackendUserStatus
}

export type BackendHealth = {
  version: string | null
  totalUsers: number | null
  activeUsers: number | null
  incomingBytes: number | null
  outgoingBytes: number | null
}

export type BackendInfo = {
  id: string
  label: string
  /** For display only. */
  baseUrl: string | null
  configured: boolean
}

export type BackendErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE'

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code: BackendErrorCode,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'BackendError'
  }
}

/**
 * Everything the panel needs from a VPN server. Implementations translate
 * their own errors into BackendError and never return provider-specific shapes.
 */
export interface VpnBackend {
  readonly id: string
  info: () => BackendInfo
  /** `repair` lets a backend heal accounts it knows how to fix; default true. */
  getUser: (
    username: string,
    options?: { repair?: boolean },
  ) => Promise<BackendUser>
  listUsers: (
    params?: ListUsersParams,
  ) => Promise<{ users: BackendUser[]; total: number }>
  createUser: (input: CreateUserInput) => Promise<BackendUser>
  updateUser: (username: string, patch: UpdateUserInput) => Promise<BackendUser>
  deleteUser: (username: string) => Promise<void>
  resetUsage: (username: string) => Promise<BackendUser>
  /** Issues a new subscription link and invalidates the old one. */
  revokeSubscription: (username: string) => Promise<BackendUser>
  /** Cheap round trip that proves credentials and connectivity. */
  health: () => Promise<BackendHealth>
}
