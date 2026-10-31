import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'

import {
  DashboardOverview,
  DashboardSection,
} from '#/components/dashboard/dashboard-overview'
import { Badge } from '#/components/ui/badge'
import { QueryErrorState } from '#/components/query-error-state'
import { Button } from '#/components/ui/button'

import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

const authRoute = getRouteApi('/_authenticated')

function DashboardPage() {
  const { t } = useI18n()

  const { session } = authRoute.useRouteContext()
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, error, refetch } = useQuery(
    orpc.dashboard.queryOptions({ input: {} }),
  )

  return (
    <DashboardOverview
      data={data}
      loading={isLoading}
      failed={Boolean(error)}
      isAdmin={session.user.role === 'admin'}
      refreshing={isFetching}
      onRefresh={() => {
        void refetch()
        void queryClient.invalidateQueries({
          queryKey: orpc.customers.renewals.key(),
        })
      }}
    >
      {error ? (
        <QueryErrorState error={t(error)} onRetry={() => void refetch()} />
      ) : null}
      <RenewalInbox />
    </DashboardOverview>
  )
}

function RenewalInbox() {
  const { t, numberLocale, formatDate } = useI18n()

  const queryClient = useQueryClient()
  const query = useQuery({
    ...orpc.customers.renewals.queryOptions(),
    refetchInterval: 60_000,
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.customers.renewals.key(),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.vpnUsers.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.billing.mySummary.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.wallet.mine.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.dashboard.key() }),
    ])
  const approve = useMutation({
    mutationFn: (id: string) => orpc.customers.approveRenewal.call({ id }),
    onSuccess: async () => {
      await refresh()
      toastSuccess(t('تمدید انجام شد'))
    },
    onError: (err) => toastError(t('تمدید انجام نشد'), err),
  })
  const reject = useMutation({
    mutationFn: (id: string) => orpc.customers.rejectRenewal.call({ id }),
    onSuccess: async () => {
      await refresh()
      toastSuccess(t('درخواست رد شد'))
    },
    onError: (err) => toastError(t('رد درخواست انجام نشد'), err),
  })

  if (query.error)
    return (
      <QueryErrorState
        title={t('درخواست‌های تمدید بارگذاری نشد')}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    )
  if (!query.data?.length) return null
  return (
    <DashboardSection
      title={t('درخواست‌های تمدید')}
      description={t('با تایید، اشتراک تمدید و هزینه آن حساب می‌شود')}
      action={
        <Badge variant="secondary">
          {query.data.length.toLocaleString(numberLocale)} {t('درخواست')}
        </Badge>
      }
    >
      <ul className="divide-y px-5 sm:px-6">
        {query.data.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-4 py-4 text-sm"
          >
            <div className="min-w-0 flex-1 basis-56 space-y-1">
              <span className="break-all font-mono font-medium" dir="ltr">
                {r.username}
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                {r.durationDays
                  ? `${r.durationDays.toLocaleString(numberLocale)} ${t('روز ·')}`
                  : `${r.months.toLocaleString(numberLocale)} ${t('ماهه ·')}`}{' '}
                {formatDate(r.createdAt)}
              </span>
              {r.message ? (
                <p
                  className="break-words text-xs leading-5 text-muted-foreground"
                  dir="auto"
                >
                  {r.message}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                className="h-9 px-3"
                disabled={approve.isPending || reject.isPending}
                onClick={() => approve.mutate(r.id)}
              >
                {t('تایید و تمدید')}
              </Button>
              <Button
                className="h-9 px-3"
                variant="outline"
                disabled={approve.isPending || reject.isPending}
                onClick={() => reject.mutate(r.id)}
              >
                {t('رد')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </DashboardSection>
  )
}
