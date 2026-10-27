import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DirectionProvider } from '#/components/ui/direction'
import {
  createTranslator,
  directionFor,
  localeTag,
  LOCALE_COOKIE,
} from '#/lib/i18n/core'
import type { Locale } from '#/lib/i18n/core'
import { formatBytes, formatDate, formatToman } from '#/lib/format'

function createLocaleValue(locale: Locale) {
  return {
    locale,
    direction: directionFor(locale),
    numberLocale: localeTag(locale),
    t: createTranslator(locale),
    formatBytes: (value: number | null | undefined) =>
      formatBytes(value, locale),
    formatDate: (value: string | Date | null | undefined) =>
      formatDate(value, locale),
    formatToman: (value: number | null | undefined) =>
      formatToman(value, locale),
    formatNumber: (value: number) => value.toLocaleString(localeTag(locale)),
  }
}
const LocaleContext = createContext({
  ...createLocaleValue('fa'),
  setLocale: (_locale: Locale) => {},
})

export function LocaleProvider({
  initialLocale = 'fa',
  children,
}: {
  initialLocale?: Locale
  children: ReactNode
}) {
  const [locale, setLocaleState] = useState(initialLocale)
  useEffect(() => {
    setLocaleState(initialLocale)
  }, [initialLocale])
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = directionFor(locale)
    const t = createTranslator(locale)
    document.title = location.pathname.startsWith('/s/')
      ? t('وضعیت اشتراک | مرزگاه')
      : t('مرزگاه | Marzgah')
  }, [locale])
  const value = useMemo(
    () => ({
      ...createLocaleValue(locale),
      setLocale(next: Locale) {
        document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
        document.documentElement.lang = next
        document.documentElement.dir = directionFor(next)
        setLocaleState(next)
      },
    }),
    [locale],
  )
  return (
    <LocaleContext value={value}>
      <DirectionProvider direction={value.direction}>
        {children}
      </DirectionProvider>
    </LocaleContext>
  )
}

export function useI18n() {
  return useContext(LocaleContext)
}
