import { localeTag } from '#/lib/i18n/core'
import type { Locale } from '#/lib/i18n/core'
import type { ChartConfig } from '#/components/ui/chart'

export type BillingEvent = {
  id: string
  resellerId: string
  marzbanUsername: string
  type: 'create' | 'renew' | 'extra_gb'
  dataLimitGb: number
  durationMonths: number | null
  durationDays?: number | null
  pricePerGbToman: number
  amountToman: number
  claimedPaidAt: string | null
  settledAt: string | null
  createdAt: string
}

export type LedgerSummary = {
  soldGb: number
  totalToman: number
  settledToman: number
  claimedToman: number
  outstandingToman: number
  eventCount: number
}

export const trendChartConfig = {
  amount: {
    label: 'فروش',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig

export const settlementChartConfig = {
  settled: {
    label: 'تسویه شده',
    color: 'var(--chart-2)',
  },
  claimed: {
    label: 'ادعای پرداخت',
    color: 'var(--chart-4)',
  },
  outstanding: {
    label: 'بدهی باز',
    color: 'var(--chart-5)',
  },
} satisfies ChartConfig

export const typeChartConfig = {
  create: {
    label: 'ایجاد',
    color: 'var(--chart-1)',
  },
  renew: {
    label: 'تمدید',
    color: 'var(--chart-3)',
  },
  extra_gb: {
    label: 'افزایش حجم',
    color: 'var(--chart-4)',
  },
} satisfies ChartConfig

export const resellerChartConfig = {
  outstanding: {
    label: 'بدهی',
    color: 'var(--chart-5)',
  },
  settled: {
    label: 'تسویه',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig

export function eventTypeLabel(type: BillingEvent['type']) {
  if (type === 'create') return 'ایجاد'
  if (type === 'renew') return 'تمدید'
  return 'افزایش حجم'
}

export function compactToman(value: number, locale: Locale = 'fa') {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString(localeTag(locale), {
      maximumFractionDigits: 1,
    })}${locale === 'fa' ? 'م' : 'M'}`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString(localeTag(locale), {
      maximumFractionDigits: 0,
    })}${locale === 'fa' ? 'ه' : 'K'}`
  }
  return value.toLocaleString(localeTag(locale))
}

export function localDayStarts(days = 14, now = new Date()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: days + 1 }, (_, index) => {
    const day = new Date(today)
    day.setDate(today.getDate() - days + 1 + index)
    return day.getTime()
  })
}

export function buildDailyTrend(
  daily: number[],
  dayStarts: number[],
  locale: Locale = 'fa',
) {
  return daily.map((amount, index) => {
    const day = new Date(dayStarts[index])
    return {
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      label: day.toLocaleDateString(localeTag(locale), {
        month: 'short',
        day: 'numeric',
      }),
      amount,
    }
  })
}

export function buildSettlementSlices(summary: LedgerSummary | undefined) {
  return [
    {
      key: 'settled',
      name: 'settled',
      value: summary?.settledToman ?? 0,
      fill: 'var(--color-settled)',
    },
    {
      key: 'claimed',
      name: 'claimed',
      value: summary?.claimedToman ?? 0,
      fill: 'var(--color-claimed)',
    },
    {
      key: 'outstanding',
      name: 'outstanding',
      value: Math.max(
        0,
        (summary?.outstandingToman ?? 0) - (summary?.claimedToman ?? 0),
      ),
      fill: 'var(--color-outstanding)',
    },
  ].filter((row) => row.value > 0)
}

export function buildTypeBars(totals: Record<BillingEvent['type'], number>) {
  return (Object.keys(totals) as Array<keyof typeof totals>).map((key) => ({
    type: key,
    label: eventTypeLabel(key),
    amount: totals[key],
    fill: `var(--color-${key})`,
  }))
}
