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

export function buildDailyTrend(
  events: BillingEvent[],
  days = 14,
  locale: Locale = 'fa',
) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets = new Map<
    string,
    { date: string; label: string; amount: number }
  >()

  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today)
    day.setDate(today.getDate() - i)
    const key = day.toISOString().slice(0, 10)
    buckets.set(key, {
      date: key,
      label: day.toLocaleDateString(localeTag(locale), {
        month: 'short',
        day: 'numeric',
      }),
      amount: 0,
    })
  }

  for (const event of events) {
    const iso =
      typeof event.createdAt === 'string'
        ? event.createdAt
        : new Date(event.createdAt).toISOString()
    const key = iso.slice(0, 10)
    const bucket = buckets.get(key)
    if (bucket) bucket.amount += event.amountToman
  }

  return [...buckets.values()]
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

export function buildTypeBars(events: BillingEvent[]) {
  const totals = {
    create: 0,
    renew: 0,
    extra_gb: 0,
  }
  for (const event of events) {
    totals[event.type] += event.amountToman
  }
  return (Object.keys(totals) as Array<keyof typeof totals>).map((key) => ({
    type: key,
    label: eventTypeLabel(key),
    amount: totals[key],
    fill: `var(--color-${key})`,
  }))
}
