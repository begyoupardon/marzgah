import english from './en.json'

export type Locale = 'fa' | 'en'
export const LOCALE_COOKIE = 'marzgah-locale'
export const localeTag = (locale: Locale) =>
  locale === 'fa' ? 'fa-IR' : 'en-US'
export const directionFor = (locale: Locale): 'rtl' | 'ltr' =>
  locale === 'fa' ? 'rtl' : 'ltr'
export const normalizeLocale = (value: unknown): Locale =>
  value === 'en' ? 'en' : 'fa'
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
