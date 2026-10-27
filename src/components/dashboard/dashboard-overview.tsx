import { useI18n } from '#/components/locale-provider'
import { Link } from '@tanstack/react-router'
import {
  ActivityIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  Clock3Icon,
  RefreshCwIcon,
  UsersIcon,
  UsersRoundIcon,
  WavesIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'

import type { AppRouterClient } from '#/orpc/client'

type DashboardData = Pick<
  Awaited<ReturnType<AppRouterClient['dashboard']>>,
  'stats' | 'atRisk' | 'recentEvents'
>

const eventLabels: Record<string, string> = {
  user_created: 'ایجاد کاربر',
  user_updated: 'به‌روزرسانی',
  user_deleted: 'حذف کاربر',
  user_expired: 'انقضای اشتراک',
  user_limited: 'محدودیت مصرف',
  user_disabled: 'غیرفعال‌سازی',
  user_enabled: 'فعال‌سازی',
}

export function DashboardSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  const { t } = useI18n()

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold leading-6">{t(title)}</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {t(description)}
          </p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function DashboardOverview({
  data,
  loading,
  failed,
  isAdmin,
  refreshing,
  onRefresh,
  children,
}: {
  data?: DashboardData
  loading: boolean
  failed: boolean
  isAdmin: boolean
  refreshing: boolean
  onRefresh: () => void
  children?: ReactNode
}) {
  const { numberLocale, t, formatBytes, formatDate } = useI18n()

  const stats = data?.stats
  const number = (value?: number) =>
    value == null ? '—' : value.toLocaleString(numberLocale)
  const metrics = [
    {
      title: t('کل کاربران'),
      value: number(stats?.totalUsers),
      hint: t('{0} کاربر غیرفعال', { '0': number(stats?.disabledUsers) }),
      icon: UsersIcon,
    },
    {
      title: t('کاربران فعال'),
      value: number(stats?.activeUsers),
      hint: t('{0} محدود · {1} منقضی', {
        '0': number(stats?.limitedUsers),
        '1': number(stats?.expiredUsers),
      }),
      icon: CheckCircle2Icon,
    },
    {
      title: t('ترافیک مصرفی'),
      value: stats ? formatBytes(stats.usedTrafficBytes) : '—',
      hint: stats
        ? t('مجموع سقف: {0}', { '0': formatBytes(stats.dataLimitBytes) })
        : t('مجموع مصرف کاربران'),
      icon: WavesIcon,
    },
    isAdmin
      ? {
          title: t('نمایندگان'),
          value: number(stats?.resellerCount),
          hint: t('نمایندگان ثبت‌شده در سامانه'),
          icon: UsersRoundIcon,
        }
      : {
          title: t('محدود / منقضی'),
          value: stats
            ? `${number(stats.limitedUsers)} / ${number(stats.expiredUsers)}`
            : '—',
          hint: t('اشتراک‌های نیازمند بررسی'),
          icon: Clock3Icon,
        },
  ]

  return (
    <div className="@container space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold leading-9">{t('نمای کلی')}</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {t('وضعیت کاربران، مصرف و پیگیری‌های امروز')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-9 gap-2 px-3"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCwIcon
              className={
                refreshing ? 'animate-spin motion-reduce:animate-none' : ''
              }
            />
            {t('به‌روزرسانی')}
          </Button>
          <Button
            className="h-9 gap-2 px-3"
            render={<Link to="/users" />}
            nativeButton={false}
          >
            {t('مدیریت کاربران')} <ArrowLeftIcon className="ltr:rotate-180" />
          </Button>
        </div>
      </div>

      <dl
        aria-label={t('خلاصه وضعیت')}
        aria-busy={loading}
        className="grid grid-cols-1 gap-4 @min-[20rem]:grid-cols-2 @min-[52rem]:grid-cols-4"
      >
        {metrics.map(({ title, value, hint, icon: Icon }) => (
          <div
            key={t(title)}
            className="min-w-0 rounded-xl border bg-card p-4 text-card-foreground @min-[28rem]:p-5"
          >
            <dt className="flex items-center justify-between gap-3 text-xs text-muted-foreground @min-[28rem]:text-sm">
              {t(title)}
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-primary"
              />
            </dt>
            <dd className="mt-3 space-y-2 @min-[28rem]:mt-4">
              {loading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <p className="break-words text-xl font-semibold leading-9 tabular-nums @min-[28rem]:text-2xl">
                  {value}
                </p>
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                {loading ? t('در حال بارگذاری…') : hint}
              </p>
            </dd>
          </div>
        ))}
      </dl>

      {children}

      <div
        className={`grid items-start gap-6 ${isAdmin ? '@min-[50rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}`}
      >
        <DashboardSection
          title={t('نیاز به پیگیری')}
          description={t('اشتراک‌های نزدیک به انقضا، مصرف بالا و بدهی باز')}
          action={
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/users" search={{ view: 'expiring' }} />}
              nativeButton={false}
            >
              {t('مشاهده کاربران')} <ArrowLeftIcon className="ltr:rotate-180" />
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-px border-b bg-border @min-[36rem]:grid-cols-3">
            {(
              [
                {
                  title: t('انقضا تا ۷ روز'),
                  value: data?.atRisk.expiring,
                  view: 'expiring',
                },
                {
                  title: t('مصرف بالای ۹۰٪'),
                  value: data?.atRisk.highUsage,
                  view: 'high_usage',
                },
                {
                  title: t('تسویه‌نشده'),
                  value: data?.atRisk.unpaid,
                  view: 'unpaid',
                },
              ] as const
            ).map((item) => (
              <Link
                key={item.view}
                to="/users"
                search={{ view: item.view }}
                className="flex items-center justify-between gap-3 bg-card px-5 py-4 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 @min-[36rem]:block"
              >
                <span className="text-xs text-muted-foreground">
                  {t(item.title)}
                </span>
                {loading ? (
                  <Skeleton className="mt-2 h-7 w-12" />
                ) : (
                  <p className="text-xl font-semibold tabular-nums @min-[36rem]:mt-2">
                    {number(item.value)}
                  </p>
                )}
              </Link>
            ))}
          </div>
          {loading ? (
            <LoadingRows />
          ) : failed && !data ? (
            <EmptyState
              title={t('اطلاعات در دسترس نیست')}
              description={t('برای دریافت وضعیت کاربران دوباره تلاش کنید.')}
            />
          ) : data?.atRisk.expiringSoon.length ? (
            <ul className="divide-y px-5 sm:px-6">
              {data.atRisk.expiringSoon.map((user) => (
                <li
                  key={user.username}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4"
                >
                  <div className="min-w-0 space-y-1">
                    <p
                      dir="ltr"
                      className="break-all text-start font-mono text-sm font-medium"
                    >
                      {user.username}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {user.phone ? <span dir="ltr">{user.phone}</span> : null}
                      {user.telegram ? (
                        <a
                          dir="ltr"
                          className="text-primary underline-offset-4 hover:underline"
                          href={`https://t.me/${encodeURIComponent(user.telegram)}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          @{user.telegram}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-1 text-xs sm:text-end">
                    <p className="text-muted-foreground">{t('زمان انقضا')}</p>
                    <p>{formatDate(user.expireAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={t('انقضای نزدیک ندارید')}
              description={t('هیچ اشتراکی در ۷ روز آینده منقضی نمی‌شود.')}
            />
          )}
        </DashboardSection>

        {isAdmin ? (
          <DashboardSection
            title={t('فعالیت‌های اخیر')}
            description={t('آخرین رویدادهای همگام‌سازی سامانه')}
            action={
              <ActivityIcon
                aria-hidden="true"
                className="mt-1 size-4 text-muted-foreground"
              />
            }
          >
            {loading ? (
              <LoadingRows />
            ) : failed && !data ? (
              <EmptyState
                title={t('فعالیت‌ها بارگذاری نشد')}
                description={t(
                  'پس از به‌روزرسانی، رویدادها اینجا نمایش داده می‌شوند.',
                )}
              />
            ) : data?.recentEvents.length ? (
              <ul className="max-h-[32rem] divide-y overflow-y-auto px-5 sm:px-6">
                {data.recentEvents.map((event) => (
                  <li key={event.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        dir="ltr"
                        className="min-w-0 break-all font-mono text-sm font-medium"
                      >
                        {event.username || '—'}
                      </span>
                      <Badge
                        variant="secondary"
                        className="max-w-full break-all whitespace-normal"
                      >
                        {t(eventLabels[event.action] ?? event.action)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(event.createdAt)}
                    </p>
                    {event.error ? (
                      <p className="break-words text-xs leading-5 text-destructive">
                        {event.error}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={t('هنوز رویدادی ثبت نشده')}
                description={t(
                  'رویدادهای همگام‌سازی در این بخش نمایش داده می‌شوند.',
                )}
              />
            )}
          </DashboardSection>
        ) : null}
      </div>
    </div>
  )
}

function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  const { t } = useI18n()

  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-medium">{t(title)}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {t(description)}
      </p>
    </div>
  )
}

function LoadingRows() {
  const { t } = useI18n()

  return (
    <div className="space-y-4 px-6 py-5" aria-label={t('در حال بارگذاری')}>
      {[1, 2, 3].map((key) => (
        <div key={key} className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
