import { createTranslator } from '#/lib/i18n/core'
import { LanguageSwitcher } from '#/components/language-switcher'
import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ClockIcon, CopyIcon, ShieldAlertIcon } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

import { BrandLogo } from '#/components/brand-logo'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Progress } from '#/components/ui/progress'
import { Skeleton } from '#/components/ui/skeleton'
import { CLIENT_APPS } from '#/lib/client-apps'
import { statusLabel } from '#/lib/format'
import { getErrorMessage } from '#/lib/errors'
import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'
import type { AppRouterClient } from '#/orpc/client'

export const Route = createFileRoute('/s/$token')({
  // The URL is the credential: keep it out of caches, referrers and search engines.
  headers: () => ({
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
  }),
  head: ({ match }) => ({
    meta: [
      {
        title: createTranslator(match.context.locale)('وضعیت اشتراک | مرزگاه'),
      },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
  component: CustomerPage,
})

const MONTHS = [1, 2, 3] as const

function daysLeft(expireAt: string | null) {
  if (!expireAt) return null
  return Math.ceil((new Date(expireAt).getTime() - Date.now()) / 86_400_000)
}

function CustomerPage() {
  const { t } = useI18n()

  const { token } = Route.useParams()
  const query = useQuery({
    ...orpc.public.view.queryOptions({ input: { token } }),
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-background p-4 pb-10">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <BrandLogo className="mx-auto my-3 w-32" />
      {query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : query.error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ShieldAlertIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">{t(getErrorMessage(query.error))}</p>
            <p className="text-sm text-muted-foreground">
              {t('از فروشنده خود لینک جدید بخواهید.')}
            </p>
          </CardContent>
        </Card>
      ) : query.data ? (
        <Content
          token={token}
          data={query.data}
          onChanged={() => void query.refetch()}
        />
      ) : null}
    </main>
  )
}

type View = Awaited<ReturnType<AppRouterClient['public']['view']>>

function Content({
  token,
  data,
  onChanged,
}: {
  token: string
  data: View
  onChanged: () => void
}) {
  const { t, formatDate, formatBytes, numberLocale } = useI18n()

  const percent = data.limitBytes
    ? Math.min(100, Math.round((data.usedBytes / data.limitBytes) * 100))
    : 0
  const days = daysLeft(data.expireAt)
  const expired = days != null && days <= 0
  const statusColor =
    data.status === 'active' && !expired
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : 'bg-destructive/10 text-destructive'

  return (
    <>
      <header className="space-y-1 pt-4 text-center">
        {data.seller.name ? (
          <p className="text-sm text-muted-foreground">{data.seller.name}</p>
        ) : null}
        <h1 className="font-mono text-xl font-semibold" dir="ltr">
          {data.username}
        </h1>
        <Badge className={`border-0 ${statusColor}`}>
          {expired ? t('منقضی شده') : t(statusLabel(data.status))}
        </Badge>
      </header>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t('مصرف و اعتبار')}</CardTitle>
          <CardDescription>
            {t('آخرین به‌روزرسانی:')} {formatDate(data.updatedAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>
                {formatBytes(data.usedBytes)} {t('مصرف شده')}
              </span>
              <span className="text-muted-foreground">
                {data.limitBytes
                  ? t('از {0}', { '0': formatBytes(data.limitBytes) })
                  : t('نامحدود')}
              </span>
            </div>
            <Progress value={percent} aria-label={t('مصرف')} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ClockIcon className="size-4" /> {t('انقضا')}
            </span>
            <span>
              {data.expireAt ? formatDate(data.expireAt) : t('بدون انقضا')}
              {days != null && days > 0
                ? t(' ({0} روز مانده)', {
                    '0': days.toLocaleString(numberLocale),
                  })
                : ''}
            </span>
          </div>
        </CardContent>
      </Card>

      {data.subscriptionUrl ? <Connect url={data.subscriptionUrl} /> : null}

      <Renewal
        token={token}
        pending={data.hasPendingRenewal}
        onChanged={onChanged}
      />

      {data.seller.support ? (
        <p className="text-center text-sm text-muted-foreground">
          {t('پشتیبانی:')}{' '}
          <span dir="auto" className="font-medium text-foreground">
            {data.seller.support}
          </span>
        </p>
      ) : null}
    </>
  )
}

function Connect({ url }: { url: string }) {
  const { t } = useI18n()

  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void QRCode.toDataURL(url, { margin: 1, width: 240 }).then(
      (d) => live && setQr(d),
    )
    return () => {
      live = false
    }
  }, [url])

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t('اتصال')}</CardTitle>
        <CardDescription>
          {t('لینک اشتراک را در برنامه وارد کنید یا کد QR را اسکن کنید')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {qr ? (
          <img
            src={qr}
            alt="QR"
            className="mx-auto size-48 rounded-lg border bg-white p-1"
          />
        ) : (
          <Skeleton className="mx-auto size-48" />
        )}
        <div className="flex gap-2">
          <Input
            readOnly
            dir="ltr"
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('لینک اشتراک')}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label={t('کپی لینک')}
            onClick={() =>
              void navigator.clipboard
                .writeText(url)
                .then(() => toastSuccess(t('کپی شد')))
            }
          >
            <CopyIcon />
          </Button>
        </div>
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">{t('دانلود برنامه')}</p>
          {CLIENT_APPS.map((group) => (
            <div
              key={t(group.platform)}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="w-28 text-muted-foreground">
                {t(group.platform)}
              </span>
              {group.apps.map((app) => (
                <a
                  key={app.name}
                  href={app.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-full border px-2.5 py-1 hover:bg-muted"
                >
                  {app.name}
                </a>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function Renewal({
  token,
  pending,
  onChanged,
}: {
  token: string
  pending: boolean
  onChanged: () => void
}) {
  const { t, numberLocale } = useI18n()

  const [months, setMonths] = useState<(typeof MONTHS)[number]>(1)
  const [message, setMessage] = useState('')
  const send = useMutation({
    mutationFn: () =>
      orpc.public.requestRenewal.call({
        token,
        months,
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      toastSuccess(t('درخواست تمدید ارسال شد'))
      setMessage('')
      onChanged()
    },
    onError: (err) => toastError(t('ارسال درخواست انجام نشد'), err),
  })

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t('تمدید اشتراک')}</CardTitle>
        <CardDescription>
          {t('درخواست شما برای فروشنده ارسال می‌شود')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {pending ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm">
            {t('درخواست شما ثبت شده و منتظر تایید فروشنده است.')}
          </p>
        ) : (
          <>
            <div
              className="grid grid-cols-3 gap-2"
              role="radiogroup"
              aria-label={t('مدت تمدید')}
            >
              {MONTHS.map((m) => (
                <Button
                  key={m}
                  role="radio"
                  aria-checked={months === m}
                  variant={months === m ? 'default' : 'outline'}
                  onClick={() => setMonths(m)}
                >
                  {m.toLocaleString(numberLocale)} {t('ماهه')}
                </Button>
              ))}
            </div>
            <Input
              value={t(message)}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={200}
              placeholder={t('پیام برای فروشنده (اختیاری)')}
            />
            <Button
              className="w-full"
              disabled={send.isPending}
              onClick={() => send.mutate()}
            >
              {t('ارسال درخواست')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
