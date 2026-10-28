import { createServerFn } from '@tanstack/react-start'
import type { Locale } from './core'

// Resolve each request independently: URL prefix takes precedence, then cookie.
export const getRequestLocale = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Locale> => {
    const { resolveServerLocale } = await import('./request.server')
    return resolveServerLocale()
  },
)
