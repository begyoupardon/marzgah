import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ActivityIcon, RefreshCwIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { QueryErrorState } from '#/components/query-error-state'

import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/admin/')({
  beforeLoad: async ({ context }) => {
    if (context.session?.user.role !== 'admin') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: AdminHealthPage,
})

function AdminHealthPage() {
  const { t, numberLocale, formatBytes, formatDate } = useI18n()

  const healthQuery = useQuery({
    ...orpc.admin.marzbanHealth.queryOptions(),
    refetchOnWindowFocus: false,
  })

  const data = healthQuery.data
  const ok = data?.ok === true

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('وضعیت سامانه')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('بررسی اتصال پنل به سرویس VPN')}
          </p>
        </div>
        <Button
          className="h-11 gap-2 sm:h-8"
          variant="outline"
          disabled={healthQuery.isFetching}
          onClick={() => {
            void healthQuery.refetch().then((result) => {
              if (result.error) {
                toastError(t('بررسی وضعیت انجام نشد'), result.error)
                return
              }
              const connected = result.data?.ok === true
              if (connected) {
                toastSuccess(
                  t('اتصال برقرار است'),
                  result.data?.baseUrl ?? undefined,
                )
              } else {
                toastError(
                  t('اتصال برقرار نیست'),
                  result.data?.error ?? result.data?.baseUrl,
                )
              }
            })
          }}
        >
          <RefreshCwIcon
            className={`size-4 ${healthQuery.isFetching ? 'animate-spin' : ''}`}
          />
          {t('بررسی مجدد')}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <ActivityIcon className="size-4" />
              {t('اتصال سرویس VPN')}
            </CardTitle>
            <CardDescription dir="ltr" className="font-mono text-xs">
              {data?.baseUrl || t('MARZBAN_BASE_URL تنظیم نشده')}
            </CardDescription>
          </div>
          <StatusBadge
            loading={healthQuery.isLoading || healthQuery.isFetching}
            ok={ok}
            configured={data?.configured}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {healthQuery.error ? (
            <QueryErrorState
              error={healthQuery.error}
              onRetry={() => void healthQuery.refetch()}
              compact
            />
          ) : null}

          {healthQuery.isLoading && !data ? (
            <p className="text-sm text-muted-foreground">
              {t('در حال بررسی…')}
            </p>
          ) : null}

          {data?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {data.error}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t('تأخیر')}
              value={data?.latencyMs != null ? `${data.latencyMs} ms` : '—'}
            />
            <Stat
              label={t('نسخه')}
              value={data?.stats?.version ?? '—'}
              dir="ltr"
            />
            <Stat
              label={t('کاربران کل')}
              value={
                data?.stats?.totalUsers != null
                  ? data.stats.totalUsers.toLocaleString(numberLocale)
                  : '—'
              }
            />
            <Stat
              label={t('کاربران فعال')}
              value={
                data?.stats?.activeUsers != null
                  ? data.stats.activeUsers.toLocaleString(numberLocale)
                  : '—'
              }
            />
            <Stat
              label={t('پهنای باند ورودی')}
              value={formatBytes(data?.stats?.incomingBandwidth)}
            />
            <Stat
              label={t('پهنای باند خروجی')}
              value={formatBytes(data?.stats?.outgoingBandwidth)}
            />
            <Stat
              label={t('آخرین بررسی')}
              value={formatDate(data?.checkedAt)}
              className="sm:col-span-2"
            />
          </div>
        </CardContent>
      </Card>
      <AnnouncementEditor />
    </div>
  )
}

function StatusBadge({
  loading,
  ok,
  configured,
}: {
  loading: boolean
  ok: boolean
  configured?: boolean
}) {
  const { t } = useI18n()

  if (loading) {
    return (
      <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        {t('در حال بررسی…')}
      </span>
    )
  }

  if (!configured) {
    return (
      <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        {t('پیکربندی نشده')}
      </span>
    )
  }

  if (ok) {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        {t('متصل')}
      </span>
    )
  }

  return (
    <span className="inline-flex rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">
      {t('قطع')}
    </span>
  )
}

function Stat({
  label,
  value,
  dir,
  className,
}: {
  label: string
  value: string
  dir?: 'ltr' | 'rtl'
  className?: string
}) {
  const { t } = useI18n()

  return (
    <div
      className={`rounded-xl border bg-muted/30 px-3 py-2.5 ${className ?? ''}`}
    >
      <p className="text-xs text-muted-foreground">{t(label)}</p>
      <p className="mt-1 text-sm font-medium" dir={dir}>
        {value}
      </p>
    </div>
  )
}

function AnnouncementEditor() {
  const { t } = useI18n()

  const queryClient = useQueryClient()
  const query = useQuery(orpc.tools.announcementAdmin.queryOptions())
  const [draft, setDraft] = useState<{
    text: string
    level: 'info' | 'warning'
    active: boolean
  } | null>(null)
  const value = draft ??
    query.data ?? { text: '', level: 'info' as const, active: false }

  const save = useMutation({
    mutationFn: () => orpc.tools.setAnnouncement.call(value),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.tools.announcement.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.tools.announcementAdmin.key(),
        }),
      ])
      setDraft(null)
      toastSuccess(t('اطلاعیه ذخیره شد'))
    },
    onError: (err) => toastError(t('ذخیره اطلاعیه انجام نشد'), err),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('اطلاعیه برای نمایندگان')}</CardTitle>
        <CardDescription>
          {t('بالای همه صفحه‌ها نمایش داده می‌شود (مثلاً زمان تعمیر یا تغییر قیمت)')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={3}
          dir="auto"
          maxLength={500}
          value={value.text}
          onChange={(e) => setDraft({ ...value, text: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Switch
              checked={value.active}
              onCheckedChange={(v) => setDraft({ ...value, active: v })}
            />{' '}
            {t('نمایش فعال')}
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={value.level === 'warning'}
              onCheckedChange={(v) =>
                setDraft({ ...value, level: v ? 'warning' : 'info' })
              }
            />{' '}
            {t('هشدار')}
          </label>
          <Button
            className="ms-auto"
            disabled={save.isPending || draft === null}
            onClick={() => save.mutate()}
          >
            {t('ذخیره')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
