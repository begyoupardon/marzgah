import { localeTag } from '#/lib/i18n/core'
import type { Locale } from '#/lib/i18n/core'

export function formatBytes(
  bytes: number | null | undefined,
  locale: Locale = 'fa',
): string {
  if (bytes == null || Number.isNaN(bytes)) return '∞'
  if (bytes <= 0) return locale === 'fa' ? '۰ بایت' : '0 bytes'
  const units =
    locale === 'fa'
      ? ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت']
      : ['bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** i
  return `${value.toLocaleString(localeTag(locale), { maximumFractionDigits: value >= 10 || i === 0 ? 0 : 1 })} ${units[i]}`
}

export function formatDate(
  value: string | Date | null | undefined,
  locale: Locale = 'fa',
): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(localeTag(locale))
}

export function formatToman(
  value: number | null | undefined,
  locale: Locale = 'fa',
): string {
  if (value == null || Number.isNaN(value)) return '—'
  return locale === 'fa'
    ? `${value.toLocaleString('fa-IR')} تومان`
    : `${value.toLocaleString('en-US')} toman`
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'فعال'
    case 'disabled':
      return 'غیرفعال'
    case 'limited':
      return 'محدود'
    case 'expired':
      return 'منقضی'
    case 'on_hold':
      return 'در انتظار'
    default:
      return status
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-secondary text-secondary-foreground'
    case 'disabled':
      return 'bg-muted text-muted-foreground'
    case 'limited':
      return 'bg-accent text-accent-foreground'
    case 'expired':
      return 'bg-destructive/10 text-destructive'
    case 'on_hold':
      return 'bg-muted text-foreground'
    default:
      return 'bg-muted text-muted-foreground'
  }
}
