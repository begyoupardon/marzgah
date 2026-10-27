import { useI18n } from '#/components/locale-provider'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { cn } from 'cn'
import {
  CircleDollarSignIcon,
  HandCoinsIcon,
  ReceiptIcon,
  WalletIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'

import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { QueryErrorState } from '#/components/query-error-state'

import {
  buildDailyTrend,
  buildSettlementSlices,
  buildTypeBars,
  compactToman,
  resellerChartConfig,
  settlementChartConfig,
  trendChartConfig,
  typeChartConfig,
} from '#/lib/sales-analytics'
import type { BillingEvent } from '#/lib/sales-analytics'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/analytics')({
  component: AnalyticsPage,
})

const authRoute = getRouteApi('/_authenticated')

function AnalyticsPage() {
  const { t, formatToman, numberLocale, locale } = useI18n()

  const { session } = authRoute.useRouteContext()
  const isAdmin = session.user.role === 'admin'
  const [filterResellerId, setFilterResellerId] = useState('')

  const resellerSummaryQuery = useQuery({
    ...orpc.billing.mySummary.queryOptions(),
    enabled: !isAdmin,
  })

  const adminSummaryQuery = useQuery({
    ...orpc.billing.adminSummary.queryOptions({
      input: filterResellerId ? { resellerId: filterResellerId } : {},
    }),
    enabled: isAdmin,
  })

  const summary = isAdmin
    ? adminSummaryQuery.data?.summary
    : resellerSummaryQuery.data?.summary

  const allEvents = useMemo(() => {
    const raw = (
      isAdmin
        ? adminSummaryQuery.data?.events
        : resellerSummaryQuery.data?.events
    ) as BillingEvent[] | undefined
    return raw ?? []
  }, [
    adminSummaryQuery.data?.events,
    isAdmin,
    resellerSummaryQuery.data?.events,
  ])

  const trendData = useMemo(
    () => buildDailyTrend(allEvents, 14, locale),
    [allEvents, locale],
  )
  const settlementData = useMemo(
    () => buildSettlementSlices(summary),
    [summary],
  )
  const typeData = useMemo(
    () =>
      buildTypeBars(allEvents).map((item) => ({
        ...item,
        label: t(item.label),
      })),
    [allEvents, t],
  )
  const hasTrend = trendData.some((d) => d.amount > 0)
  const settledRatio =
    summary && summary.totalToman > 0
      ? Math.round((summary.settledToman / summary.totalToman) * 100)
      : 0

  const resellerBars = useMemo(() => {
    if (!isAdmin || filterResellerId) return []
    return (adminSummaryQuery.data?.byReseller ?? [])
      .map((row) => ({
        name: row.reseller?.name ?? row.resellerId.slice(0, 8),
        outstanding: row.outstandingToman,
        settled: row.settledToman,
      }))
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 8)
  }, [adminSummaryQuery.data?.byReseller, filterResellerId, isAdmin])

  const loading = isAdmin
    ? adminSummaryQuery.isLoading
    : resellerSummaryQuery.isLoading

  const summaryError = isAdmin
    ? adminSummaryQuery.error
    : resellerSummaryQuery.error

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('آمار فروش')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('نمودارها و خلاصه فروش؛ مدیریت تسویه در صفحه جداگانه است')}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {isAdmin ? (
            <Select
              items={(adminSummaryQuery.data?.resellers ?? []).map((r) => ({
                value: r.id,
                label: `${r.name} (${r.email})`,
              }))}
              value={filterResellerId || null}
              onValueChange={(value) => setFilterResellerId(value ?? '')}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder={t('همه نمایندگان')} />
              </SelectTrigger>
              <SelectContent>
                {(adminSummaryQuery.data?.resellers ?? []).map((r) => (
                  <SelectItem
                    key={r.id}
                    value={r.id}
                    label={`${r.name} (${r.email})`}
                    description={r.email}
                  >
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant="outline"
            className="h-11 sm:h-8"
            nativeButton={false}
            render={<Link to="/sales" />}
          >
            {t('تسویه و بدهی')}
          </Button>
        </div>
      </div>

      {summaryError ? (
        <QueryErrorState
          error={summaryError}
          onRetry={() =>
            void (isAdmin
              ? adminSummaryQuery.refetch()
              : resellerSummaryQuery.refetch())
          }
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('فروش کل')}
          value={formatToman(summary?.totalToman ?? 0)}
          hint={t('{0} گیگابایت · {1} ردیف', {
            '0': (summary?.soldGb ?? 0).toLocaleString(numberLocale),
            '1': (summary?.eventCount ?? 0).toLocaleString(numberLocale),
          })}
          icon={<ReceiptIcon className="size-4" />}
          loading={loading}
        />
        <KpiCard
          title={t('تسویه شده')}
          value={formatToman(summary?.settledToman ?? 0)}
          hint={t('{0}٪ از فروش کل', {
            '0': settledRatio.toLocaleString(numberLocale),
          })}
          icon={<CircleDollarSignIcon className="size-4" />}
          loading={loading}
        />
        <KpiCard
          title={t('ادعای پرداخت')}
          value={formatToman(summary?.claimedToman ?? 0)}
          hint={t('در انتظار تایید مدیر')}
          icon={<HandCoinsIcon className="size-4" />}
          loading={loading}
        />
        <KpiCard
          title={t('مانده بدهی')}
          value={formatToman(summary?.outstandingToman ?? 0)}
          hint={t('تا تسویه مدیر باز می‌ماند')}
          icon={<WalletIcon className="size-4" />}
          emphasize
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('روند فروش ۱۴ روز اخیر')}</CardTitle>
            <CardDescription>
              {t('مجموع مبلغ ردیف‌های مالی ثبت‌شده در هر روز')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasTrend ? (
              <ChartContainer
                config={trendChartConfig}
                className="aspect-auto h-64 w-full"
              >
                <AreaChart
                  data={trendData}
                  margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="fillAmount" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="var(--color-amount)"
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="95%"
                        stopColor="var(--color-amount)"
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(value: number) =>
                      compactToman(value, locale)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        indicator="line"
                        formatter={(value) => (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">
                              {t('فروش')}
                            </span>
                            <span className="font-mono font-medium">
                              {formatToman(Number(value))}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Area
                    dataKey="amount"
                    type="monotone"
                    fill="url(#fillAmount)"
                    stroke="var(--color-amount)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyChart
                message={t('هنوز فروشی در ۱۴ روز اخیر ثبت نشده است')}
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('ترکیب تسویه')}</CardTitle>
            <CardDescription>
              {t('سهم بدهی، ادعای پرداخت و تسویه')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settlementData.length > 0 ? (
              <ChartContainer
                config={settlementChartConfig}
                className="mx-auto aspect-square max-h-64"
              >
                <PieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        hideLabel
                        nameKey="name"
                        formatter={(value, name) => (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">
                              {settlementChartConfig[
                                name as keyof typeof settlementChartConfig
                              ]?.label ?? name}
                            </span>
                            <span className="font-mono font-medium">
                              {formatToman(Number(value))}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Pie
                    data={settlementData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={84}
                    strokeWidth={2}
                  >
                    {settlementData.map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartLegend
                    content={<ChartLegendContent nameKey="name" />}
                  />
                </PieChart>
              </ChartContainer>
            ) : (
              <EmptyChart message={t('داده‌ای برای ترکیب تسویه نیست')} />
            )}
          </CardContent>
          <CardFooter className="justify-between text-xs text-muted-foreground">
            <span>{t('بدهی باز')}</span>
            <span className="font-medium text-foreground">
              {formatToman(summary?.outstandingToman ?? 0)}
            </span>
          </CardFooter>
        </Card>
      </div>

      <div
        className={cn(
          'grid gap-4',
          isAdmin && !filterResellerId && resellerBars.length > 0
            ? 'lg:grid-cols-2'
            : 'grid-cols-1',
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('فروش بر اساس نوع رویداد')}</CardTitle>
            <CardDescription>{t('ایجاد، تمدید و افزایش حجم')}</CardDescription>
          </CardHeader>
          <CardContent>
            {typeData.some((d) => d.amount > 0) ? (
              <ChartContainer
                config={typeChartConfig}
                className="aspect-auto h-64 w-full"
              >
                <BarChart
                  data={typeData}
                  margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(value: number) =>
                      compactToman(value, locale)
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(value) => (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">
                              {t('مبلغ')}
                            </span>
                            <span className="font-mono font-medium">
                              {formatToman(Number(value))}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="amount" radius={6}>
                    {typeData.map((entry) => (
                      <Cell key={entry.type} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyChart message={t('هنوز رویداد مالی ثبت نشده است')} />
            )}
          </CardContent>
        </Card>

        {isAdmin && !filterResellerId && resellerBars.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('نمایندگان با بیشترین بدهی')}</CardTitle>
              <CardDescription>
                {t('مقایسه بدهی باز و مبلغ تسویه‌شده')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={resellerChartConfig}
                className="aspect-auto h-64 w-full"
              >
                <BarChart
                  data={resellerBars}
                  layout="vertical"
                  margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) =>
                      compactToman(value, locale)
                    }
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={88}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <div className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">
                              {resellerChartConfig[
                                name as keyof typeof resellerChartConfig
                              ]?.label ?? name}
                            </span>
                            <span className="font-mono font-medium">
                              {formatToman(Number(value))}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="outstanding"
                    stackId="a"
                    fill="var(--color-outstanding)"
                  />
                  <Bar
                    dataKey="settled"
                    stackId="a"
                    fill="var(--color-settled)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function KpiCard({
  title,
  value,
  hint,
  icon,
  emphasize,
  loading,
}: {
  title: string
  value: string
  hint?: string
  icon: ReactNode
  emphasize?: boolean
  loading?: boolean
}) {
  const { t } = useI18n()

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardDescription>{t(title)}</CardDescription>
        <CardTitle
          className={cn(
            'text-xl',
            emphasize && 'text-destructive',
            loading && 'animate-pulse text-muted-foreground',
          )}
        >
          {loading ? '…' : value}
        </CardTitle>
        <CardAction>
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground',
              emphasize && 'bg-destructive/10 text-destructive',
            )}
          >
            {icon}
          </div>
        </CardAction>
      </CardHeader>
      {hint ? (
        <CardFooter className="text-xs text-muted-foreground">
          {t(hint)}
        </CardFooter>
      ) : null}
    </Card>
  )
}

function EmptyChart({ message }: { message: string }) {
  const { t } = useI18n()

  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      {t(message)}
    </div>
  )
}
