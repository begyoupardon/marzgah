import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { CircleDollarSignIcon, HandCoinsIcon, WalletIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { QueryErrorState } from '#/components/query-error-state'
import { settlementStatus } from '#/lib/billing'

import { eventTypeLabel } from '#/lib/sales-analytics'
import type { BillingEvent } from '#/lib/sales-analytics'
import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/sales')({
  component: SalesPage,
})

const authRoute = getRouteApi('/_authenticated')

function SettlementBadge({ event }: { event: BillingEvent }) {
  const { t } = useI18n()

  const status = settlementStatus(event)
  if (status === 'settled') {
    return (
      <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        {t('تسویه شده')}
      </Badge>
    )
  }
  if (status === 'claimed') {
    return (
      <Badge className="border-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">
        {t('ادعای پرداخت')}
      </Badge>
    )
  }
  return (
    <Badge className="border-0 bg-destructive/10 text-destructive">
      {t('بدهی')}
    </Badge>
  )
}

function SalesPage() {
  const { t, formatToman, numberLocale, formatDate } = useI18n()

  const { session } = authRoute.useRouteContext()
  const queryClient = useQueryClient()
  const isAdmin = session.user.role === 'admin'
  const [filterResellerId, setFilterResellerId] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'outstanding' | 'claimed' | 'settled'
  >('outstanding')
  const [pending, setPending] = useState<{
    mode: 'claim' | 'settle' | 'unsettle'
    event: BillingEvent
  } | null>(null)

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

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.billing.mySummary.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.billing.adminSummary.key(),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.billing.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() }),
    ])
  }

  const claimMutation = useMutation({
    mutationFn: (eventId: string) => orpc.billing.claimPaid.call({ eventId }),
    onSuccess: async () => {
      await invalidate()
      toastSuccess(t('پرداخت اعلام شد'))
      setPending(null)
    },
    onError: (err) => {
      toastError(t('اعلام پرداخت انجام نشد'), err)
    },
  })

  const settleMutation = useMutation({
    mutationFn: (eventId: string) => orpc.billing.settle.call({ eventId }),
    onSuccess: async () => {
      await invalidate()
      toastSuccess(t('تسویه تایید شد'))
      setPending(null)
    },
    onError: (err) => {
      toastError(t('تایید تسویه انجام نشد'), err)
    },
  })

  const unsettleMutation = useMutation({
    mutationFn: (eventId: string) => orpc.billing.unsettle.call({ eventId }),
    onSuccess: async () => {
      await invalidate()
      toastSuccess(t('تسویه برگشت خورد'))
      setPending(null)
    },
    onError: (err) => {
      toastError(t('برگشت تسویه انجام نشد'), err)
    },
  })

  const summary = isAdmin
    ? adminSummaryQuery.data?.summary
    : resellerSummaryQuery.data?.summary

  const summaryError = isAdmin
    ? adminSummaryQuery.error
    : resellerSummaryQuery.error

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

  const events = useMemo(() => {
    if (statusFilter === 'all') return allEvents
    return allEvents.filter((e) => settlementStatus(e) === statusFilter)
  }, [allEvents, statusFilter])

  const busy =
    claimMutation.isPending ||
    settleMutation.isPending ||
    unsettleMutation.isPending

  const loading = isAdmin
    ? adminSummaryQuery.isLoading
    : resellerSummaryQuery.isLoading

  const confirmCopy =
    pending?.mode === 'claim'
      ? {
          title: t('اعلام پرداخت'),
          description: t(
            'آیا پرداخت این ردیف را انجام داده‌اید؟ تا تایید مدیر، بدهی باز می‌ماند.',
          ),
          confirm: t('پرداخت کردم'),
        }
      : pending?.mode === 'settle'
        ? {
            title: t('تایید تسویه'),
            description: t('با تایید، این مبلغ از بدهی نماینده کم می‌شود.'),
            confirm: t('تسویه شد'),
          }
        : {
            title: t('برگشت تسویه'),
            description: t('این ردیف دوباره به بدهی باز برمی‌گردد.'),
            confirm: t('برگشت تسویه'),
          }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('تسویه و بدهی')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('اعلام پرداخت، تایید تسویه و پیگیری بدهی‌های باز')}
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
          <Select
            items={{
              outstanding: t('بدهی'),
              claimed: t('ادعای پرداخت'),
              settled: t('تسویه شده'),
              all: t('همه'),
            }}
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value ?? 'all')}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder={t('وضعیت')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="outstanding" label={t('بدهی')}>
                {t('بدهی')}
              </SelectItem>
              <SelectItem value="claimed" label={t('ادعای پرداخت')}>
                {t('ادعای پرداخت')}
              </SelectItem>
              <SelectItem value="settled" label={t('تسویه شده')}>
                {t('تسویه شده')}
              </SelectItem>
              <SelectItem value="all" label={t('همه')}>
                {t('همه')}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="h-11 sm:h-8"
            nativeButton={false}
            render={<Link to="/analytics" />}
          >
            {t('آمار فروش')}
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

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title={t('مانده بدهی')}
          value={formatToman(summary?.outstandingToman ?? 0)}
          hint={t('تا تایید مدیر باز است')}
          icon={<WalletIcon className="size-4" />}
          emphasize
          loading={loading}
        />
        <KpiCard
          title={t('ادعای پرداخت')}
          value={formatToman(summary?.claimedToman ?? 0)}
          hint={t('منتظر تایید مدیر')}
          icon={<HandCoinsIcon className="size-4" />}
          loading={loading}
        />
        <KpiCard
          title={t('تسویه شده')}
          value={formatToman(summary?.settledToman ?? 0)}
          hint={t('از کل {0}', { '0': formatToman(summary?.totalToman ?? 0) })}
          icon={<CircleDollarSignIcon className="size-4" />}
          loading={loading}
        />
      </div>

      {isAdmin && !filterResellerId ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t('بدهی نمایندگان')}</CardTitle>
            <CardDescription>
              {t('برای جزئیات هر نماینده از فیلتر بالا استفاده کنید')}
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('نماینده')}</TableHead>
                  <TableHead>{t('فروش')}</TableHead>
                  <TableHead>{t('تسویه')}</TableHead>
                  <TableHead>{t('ادعای پرداخت')}</TableHead>
                  <TableHead>{t('بدهی')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(adminSummaryQuery.data?.byReseller ?? []).map((row) => (
                  <TableRow key={row.resellerId}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {row.reseller?.name ?? row.resellerId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {row.reseller?.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{formatToman(row.totalToman)}</TableCell>
                    <TableCell>{formatToman(row.settledToman)}</TableCell>
                    <TableCell>{formatToman(row.claimedToman)}</TableCell>
                    <TableCell className="font-medium text-destructive">
                      {formatToman(row.outstandingToman)}
                    </TableCell>
                  </TableRow>
                ))}
                {(adminSummaryQuery.data?.byReseller ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-20 text-center text-sm text-muted-foreground"
                    >
                      {t('هنوز ردیف مالی ثبت نشده است')}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t('ردیف‌های مالی')}</CardTitle>
          <CardDescription>
            {events.length.toLocaleString(numberLocale)} {t('ردیف')}
            {statusFilter !== 'all' ? t(' با فیلتر فعلی') : ''}
          </CardDescription>
        </CardHeader>
        <div className="grid gap-3 p-4 md:hidden">
          {events.map((event) => (
            <article
              key={event.id}
              className="space-y-3 rounded-2xl border bg-card p-4 shadow-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p
                    className="truncate font-mono text-sm font-semibold"
                    dir="ltr"
                  >
                    {event.marzbanUsername}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(eventTypeLabel(event.type))} · {event.dataLimitGb} GB
                  </p>
                </div>
                <SettlementBadge event={event} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('مبلغ')}</span>
                <span className="font-medium">
                  {formatToman(event.amountToman)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDate(event.createdAt)}</span>
                <EventActions
                  event={event}
                  isAdmin={isAdmin}
                  busy={busy}
                  onClaim={() => setPending({ mode: 'claim', event })}
                  onSettle={() => setPending({ mode: 'settle', event })}
                  onUnsettle={() => setPending({ mode: 'unsettle', event })}
                />
              </div>
            </article>
          ))}
          {events.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              {t('ردیفی برای نمایش نیست')}
            </div>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('کاربر')}</TableHead>
                <TableHead>{t('نوع')}</TableHead>
                <TableHead>{t('حجم')}</TableHead>
                <TableHead>{t('مبلغ')}</TableHead>
                <TableHead>{t('وضعیت')}</TableHead>
                <TableHead>{t('تاریخ')}</TableHead>
                <TableHead className="text-end">{t('عملیات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <span className="font-mono text-sm" dir="ltr">
                      {event.marzbanUsername}
                    </span>
                  </TableCell>
                  <TableCell>{t(eventTypeLabel(event.type))}</TableCell>
                  <TableCell>{event.dataLimitGb} GB</TableCell>
                  <TableCell>{formatToman(event.amountToman)}</TableCell>
                  <TableCell>
                    <SettlementBadge event={event} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </TableCell>
                  <TableCell className="text-end">
                    <EventActions
                      event={event}
                      isAdmin={isAdmin}
                      busy={busy}
                      onClaim={() => setPending({ mode: 'claim', event })}
                      onSettle={() => setPending({ mode: 'settle', event })}
                      onUnsettle={() => setPending({ mode: 'unsettle', event })}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {events.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    {t('ردیفی برای نمایش نیست')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AlertDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(confirmCopy.title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(confirmCopy.description)}{' '}
              {pending ? (
                <span className="font-mono text-foreground" dir="ltr">
                  {pending.event.marzbanUsername}
                </span>
              ) : null}{' '}
              ({formatToman(pending?.event.amountToman ?? 0)})
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('انصراف')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                if (!pending) return
                if (pending.mode === 'claim') {
                  claimMutation.mutate(pending.event.id)
                } else if (pending.mode === 'settle') {
                  settleMutation.mutate(pending.event.id)
                } else {
                  unsettleMutation.mutate(pending.event.id)
                }
              }}
            >
              {busy ? t('در حال انجام…') : t(confirmCopy.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function EventActions({
  event,
  isAdmin,
  busy,
  onClaim,
  onSettle,
  onUnsettle,
}: {
  event: BillingEvent
  isAdmin: boolean
  busy?: boolean
  onClaim: () => void
  onSettle: () => void
  onUnsettle: () => void
}) {
  const { t } = useI18n()

  const status = settlementStatus(event)
  if (isAdmin) {
    if (status === 'settled') {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onUnsettle}
        >
          {t('برگشت تسویه')}
        </Button>
      )
    }
    return (
      <Button size="sm" disabled={busy} onClick={onSettle}>
        {t('تایید تسویه')}
      </Button>
    )
  }
  if (status === 'outstanding') {
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={onClaim}>
        {t('پرداخت کردم')}
      </Button>
    )
  }
  return null
}
