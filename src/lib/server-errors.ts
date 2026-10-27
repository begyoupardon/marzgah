import { ORPCError, ValidationError } from '@orpc/server'

import { BackendError } from '#/lib/backends/types'
import { MarzbanApiError } from '#/lib/marzban/client'

/**
 * Normalize unknown thrown values into defined ORPCErrors with Persian messages.
 * Already-defined ORPCErrors are returned as-is.
 */
export function toAppORPCError(error: unknown): ORPCError<any, any> {
  if (error instanceof ORPCError) return error

  if (error instanceof ValidationError) {
    return new ORPCError('BAD_REQUEST', {
      message: 'ورودی نامعتبر است',
      cause: error,
    })
  }

  if (error instanceof BackendError) {
    if (error.code === 'NOT_FOUND') {
      return new ORPCError('NOT_FOUND', {
        message: 'منبع درخواستی در سرور VPN پیدا نشد',
      })
    }
    if (error.code === 'CONFLICT') {
      return new ORPCError('CONFLICT', {
        message: 'این مورد در سرور VPN قبلاً وجود دارد',
      })
    }
    if (error.code === 'INVALID' || error.code === 'UNSUPPORTED') {
      return new ORPCError('BAD_REQUEST', {
        message: 'درخواست به سرور VPN نامعتبر بود',
      })
    }
    return new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'ارتباط با سرور VPN برقرار نشد',
    })
  }

  if (error instanceof MarzbanApiError) {
    if (error.status === 404) {
      return new ORPCError('NOT_FOUND', {
        message: 'منبع درخواستی در Marzban پیدا نشد',
      })
    }
    if (error.status === 409) {
      return new ORPCError('CONFLICT', {
        message: 'این مورد در Marzban قبلاً وجود دارد',
      })
    }
    if (error.status >= 400 && error.status < 500) {
      return new ORPCError('BAD_REQUEST', {
        message: 'درخواست Marzban نامعتبر بود',
      })
    }
    return new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'ارتباط با Marzban برقرار نشد',
    })
  }

  return new ORPCError('INTERNAL_SERVER_ERROR', {
    message: 'خطای داخلی سرور رخ داد',
    cause: error instanceof Error ? error : undefined,
  })
}

export function logServerError(error: unknown, source: string) {
  if (error instanceof ORPCError) {
    if (
      [
        'BAD_REQUEST',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
      ].includes(error.code)
    ) {
      console.warn(`[${source}] ${error.code}: ${error.message}`)
      return
    }
  }
  console.error(`[${source}]`, error)
}
