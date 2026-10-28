import { createIsomorphicFn } from '@tanstack/react-start'
import { extractLocaleFromPath, LOCALE_COOKIE, normalizeLocale } from './core'
import type { Locale } from './core'

/**
 * Determine the active client-side locale.
 * Checks the URL path prefix first, then document.documentElement.lang, then cookie.
 */
export function resolveClientLocale(): Locale {
  if (typeof window === 'undefined') return 'fa'

  const fromUrl = extractLocaleFromPath(window.location.pathname)
  if (fromUrl) return fromUrl

  const docLang = document.documentElement?.lang
  if (docLang === 'en' || docLang === 'fa') return docLang

  const cookiePattern = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`)
  const match = cookiePattern.exec(document.cookie)
  if (match?.[1]) return normalizeLocale(match[1])

  return 'fa'
}

/**
 * Unified synchronous locale resolver for TanStack Router rewrites.
 * Resolves request URL / cookie on the server, and window / document on the client.
 */
export const getActiveLocale = createIsomorphicFn()
  .server((): Locale => {
    try {
      // Dynamic import to prevent bundler leakage into client environment
      const { resolveServerLocale } = require('./request.server')
      return resolveServerLocale()
    } catch {
      return 'fa'
    }
  })
  .client((): Locale => resolveClientLocale())
