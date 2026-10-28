import { ORPCError, ValidationError } from '@orpc/server'

import { BackendError } from '#/lib/backends/types'
import { MarzbanApiError } from '#/lib/marzban/client'

const ALREADY_LOGGED = Symbol.for('marzgah.orpc.logged')

export function markAsLogged(error: unknown) {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    try {
      Object.defineProperty(error, ALREADY_LOGGED, {
        value: true,
        configurable: true,
        enumerable: false,
      })
    } catch {
      ;(error as Record<string, unknown>)[ALREADY_LOGGED as unknown as string] =
        true
    }
  }
}

export function isAlreadyLogged(error: unknown): boolean {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    return Boolean((error as Record<string | symbol, unknown>)[ALREADY_LOGGED])
  }
  return false
}

function formatValidationIssues(issues: readonly unknown[]): string {
  if (!issues || issues.length === 0) return ''
  return issues
    .map((issue) => {
      const i = issue as { path?: unknown[]; message?: string }
      const field =
        Array.isArray(i.path) && i.path.length ? i.path.join('.') : ''
      return field
        ? `${field}: ${i.message ?? 'نامعتبر'}`
        : (i.message ?? 'نامعتبر')
    })
    .join(', ')
}

/**
 * Normalize unknown thrown values into defined ORPCErrors with Persian messages.
 * Already-defined ORPCErrors are returned as-is.
 */
export function toAppORPCError(error: unknown): ORPCError<any, any> {
  if (error instanceof ORPCError) return error

  if (error instanceof ValidationError) {
    const detail = formatValidationIssues(error.issues)
    return new ORPCError('BAD_REQUEST', {
      message: detail ? `ورودی نامعتبر است (${detail})` : 'ورودی نامعتبر است',
      data: { issues: error.issues },
      cause: error,
    })
  }

  if (error instanceof BackendError) {
    if (error.code === 'NOT_FOUND') {
      return new ORPCError('NOT_FOUND', {
        message: 'منبع درخواستی در سرور VPN پیدا نشد',
        cause: error,
      })
    }
    if (error.code === 'CONFLICT') {
      return new ORPCError('CONFLICT', {
        message: 'این مورد در سرور VPN قبلاً وجود دارد',
        cause: error,
      })
    }
    if (error.code === 'INVALID' || error.code === 'UNSUPPORTED') {
      return new ORPCError('BAD_REQUEST', {
        message: 'درخواست به سرور VPN نامعتبر بود',
        cause: error,
      })
    }
    return new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'ارتباط با سرور VPN برقرار نشد',
      cause: error,
    })
  }

  if (error instanceof MarzbanApiError) {
    if (error.status === 404) {
      return new ORPCError('NOT_FOUND', {
        message: 'منبع درخواستی در Marzban پیدا نشد',
        cause: error,
      })
    }
    if (error.status === 409) {
      return new ORPCError('CONFLICT', {
        message: 'این مورد در Marzban قبلاً وجود دارد',
        cause: error,
      })
    }
    if (error.status >= 400 && error.status < 500) {
      return new ORPCError('BAD_REQUEST', {
        message: 'درخواست Marzban نامعتبر بود',
        cause: error,
      })
    }
    return new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'ارتباط با Marzban برقرار نشد',
      cause: error,
    })
  }

  return new ORPCError('INTERNAL_SERVER_ERROR', {
    message: 'خطای داخلی سرور رخ داد',
    cause: error instanceof Error ? error : undefined,
  })
}

export type ProcedureLogEvent = {
  procedure: string
  status: number
  code?: string
  durationMs: number
  user?: string | null
  ip?: string | null
  message?: string
  error?: unknown
}

function isQuietTest() {
  return process.env.NODE_ENV === 'test' && !process.env.DEBUG
}

export function logProcedureEvent(event: ProcedureLogEvent) {
  if (isQuietTest()) return

  const actor = event.user ? `[user: ${event.user}]` : '[anon]'
  const ip = event.ip && event.ip !== 'unknown' ? `[ip: ${event.ip}]` : ''
  const duration = `[${event.durationMs}ms]`
  const prefix = '[orpc]'

  if (event.status < 400) {
    const line = [
      prefix,
      `${event.status} OK`,
      event.procedure,
      duration,
      actor,
      ip,
    ]
      .filter(Boolean)
      .join(' ')
    console.info(line)
    return
  }

  const code =
    event.code ?? (event.status === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR')
  const detail = event.message ? `: ${event.message}` : ''

  if (event.status < 500) {
    const line = [
      prefix,
      `${event.status} ${code}`,
      event.procedure,
      duration,
      actor,
      ip,
    ]
      .filter(Boolean)
      .join(' ')
    console.warn(`${line}${detail}`)
    return
  }

  const line = [
    prefix,
    `${event.status} ${code}`,
    event.procedure,
    duration,
    actor,
    ip,
  ]
    .filter(Boolean)
    .join(' ')
  console.error(`${line}${detail}`)
  if (event.error) {
    console.error(event.error)
  }
}

export type RequestLogMeta = {
  method?: string
  path?: string
  ip?: string | null
}

export function logServerError(
  error: unknown,
  source: string,
  meta?: RequestLogMeta,
) {
  if (isAlreadyLogged(error) || isQuietTest()) return

  const status = error instanceof ORPCError ? error.status : 500
  const code = error instanceof ORPCError ? error.code : 'INTERNAL_SERVER_ERROR'
  const message = error instanceof Error ? error.message : String(error)

  const httpInfo = [meta?.method, meta?.path].filter(Boolean).join(' ')
  const ipInfo = meta?.ip && meta.ip !== 'unknown' ? `[ip: ${meta.ip}]` : ''
  const tag = `[${source}]`

  if (status < 500) {
    const line = [tag, `${status} ${code}`, httpInfo, ipInfo]
      .filter(Boolean)
      .join(' ')
    console.warn(`${line}: ${message}`)
    return
  }

  const line = [tag, `${status} ${code}`, httpInfo, ipInfo]
    .filter(Boolean)
    .join(' ')
  console.error(`${line}: ${message}`)
  console.error(error)
}
