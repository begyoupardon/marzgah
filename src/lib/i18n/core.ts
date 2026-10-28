import english from './en.json'

export type Locale = 'fa' | 'en'
export const SUPPORTED_LOCALES = ['fa', 'en'] as const
export const DEFAULT_LOCALE: Locale = 'fa'
export const LOCALE_COOKIE = 'marzgah-locale'
export const localeTag = (locale: Locale) =>
  locale === 'fa' ? 'fa-IR' : 'en-US'
export const directionFor = (locale: Locale): 'rtl' | 'ltr' =>
  locale === 'fa' ? 'rtl' : 'ltr'
export const normalizeLocale = (value: unknown): Locale =>
  value === 'en' ? 'en' : 'fa'
export const isLocale = (value: unknown): value is Locale =>
  value === 'en' || value === 'fa'

const SYSTEM_PREFIXES = [
  '/api',
  '/_serverFn',
  '/assets',
  '/brand',
  '/licenses',
  '/__tsd',
]

export function isSystemPath(pathname: string): boolean {
  if (
    SYSTEM_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return true
  }
  // Static files with extensions (.ico, .svg, .png, .woff2, .webmanifest, .txt)
  return /\.[a-zA-Z0-9]+$/.test(pathname)
}

/**
 * Extract an explicit locale prefix from a pathname (/en/..., /fa/..., or /en, /fa).
 * Returns null if the path has no locale prefix or is a system/asset path.
 */
export function extractLocaleFromPath(pathname: string): Locale | null {
  if (isSystemPath(pathname)) return null
  const first = pathname.split('/').filter(Boolean)[0]
  if (first === 'en' || first === 'fa') return first
  return null
}

/**
 * Remove locale prefix from a path for TanStack Router internal route matching.
 * E.g. /en/dashboard -> /dashboard, /en -> /, /fa/login -> /login.
 */
export function deLocalizePath(pathname: string): string {
  if (isSystemPath(pathname)) return pathname
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length > 0 && (segs[0] === 'en' || segs[0] === 'fa')) {
    const rest = '/' + segs.slice(1).join('/')
    return rest === '' ? '/' : rest
  }
  return pathname
}

/**
 * Prefix a path with the locale for browser display and public links.
 * Non-default locale ('en') is prefixed (/en/dashboard), while default locale
 * ('fa') maintains clean unprefixed URLs (/dashboard).
 */
export function localizePath(pathname: string, locale: Locale): string {
  if (isSystemPath(pathname)) return pathname
  const clean = deLocalizePath(pathname)
  if (locale === 'en') {
    return clean === '/' ? '/en' : `/en${clean}`
  }
  return clean
}

export function deLocalizeUrl(url: URL): URL {
  url.pathname = deLocalizePath(url.pathname)
  return url
}

export function localizeUrl(url: URL, locale: Locale): URL {
  url.pathname = localizePath(url.pathname, locale)
  return url
}

export type TranslationValues = Record<string, unknown>
export type Translator = {
  (message: string, values?: TranslationValues): string
  <T>(message: T, values?: TranslationValues): T
}

// Some validation errors arrive already formatted by the server. Recognize only
// explicit catalog templates, without translating arbitrary user-supplied text.
const patterns = Object.entries(english)
  .filter(([key]) => /\{\w+\}/.test(key))
  .map(([key, value]) => {
    const names: string[] = []
    const escaped = key
      .split(/(\{\w+\})/)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          names.push(part.slice(1, -1))
          return '([\\s\\S]*?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    return { regex: new RegExp(`^${escaped}$`), names, value }
  })

export function createTranslator(locale: Locale): Translator {
  return ((message: unknown, values?: TranslationValues) => {
    if (typeof message !== 'string') return message
    let translated =
      locale === 'en'
        ? ((english as Record<string, string>)[message] ?? message)
        : message
    if (locale === 'en' && translated === message && !values) {
      for (const pattern of patterns) {
        const match = pattern.regex.exec(message)
        if (match) {
          translated = pattern.value
          values = Object.fromEntries(
            pattern.names.map((name, index) => [name, match[index + 1]]),
          )
          break
        }
      }
    }
    return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
      values && Object.hasOwn(values, key) ? String(values[key]) : match,
    )
  }) as Translator
}
