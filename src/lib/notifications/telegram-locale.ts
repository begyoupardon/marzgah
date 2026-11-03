export type TelegramLocale = 'fa' | 'en'

export const telegramLocale = (
  value: string | null | undefined,
): TelegramLocale => (value?.toLowerCase().startsWith('en') ? 'en' : 'fa')

export const tl = (locale: TelegramLocale, fa: string, en: string) =>
  locale === 'en' ? en : fa

export const tn = (locale: TelegramLocale, value: number, digits = 0) =>
  Number(value || 0).toLocaleString(locale === 'en' ? 'en-US' : 'fa-IR', {
    maximumFractionDigits: digits,
  })
