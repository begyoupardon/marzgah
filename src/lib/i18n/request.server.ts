import { getCookie, getRequestUrl } from '@tanstack/react-start/server'
import { extractLocaleFromPath, LOCALE_COOKIE, normalizeLocale } from './core'
import type { Locale } from './core'

/**
 * Server-only helper to determine the locale for the current SSR request.
 * Checks request URL pathname prefix (/en/..., /fa/...) first, then cookie.
 */
export function resolveServerLocale(): Locale {
  try {
    const urlStr = getRequestUrl()
    if (urlStr) {
      const fromPath = extractLocaleFromPath(new URL(urlStr).pathname)
      if (fromPath) return fromPath
    }
  } catch {}

  try {
    const cookie = getCookie(LOCALE_COOKIE)
    if (cookie) return normalizeLocale(cookie)
  } catch {}

  return 'fa'
}
