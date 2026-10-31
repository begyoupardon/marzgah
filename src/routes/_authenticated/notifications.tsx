import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import {
  BellIcon,
  CopyIcon,
  ExternalLinkIcon,
  SendIcon,
  XIcon,
} from 'lucide-react'
import { useState } from 'react'

import { QueryErrorState } from '#/components/query-error-state'
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
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/notifications')({
  component: NotificationsPage,
})

const authRoute = getRouteApi('/_authenticated')

function NotificationsPage() {
  const { t } = useI18n()

  const { session } = authRoute.useRouteContext()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('اعلان‌ها')}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'انقضای اشتراک، مصرف بالا، موجودی کیف پول و وضعیت پرداخت‌ها را در تلگرام دریافت کنید',
          )}
        </p>
      </div>
      <TelegramLink />
      {session.user.role === 'reseller' ? <Branding /> : null}
      {session.user.role === 'admin' ? <TelegramAdmin /> : null}
    </div>
  )
}

function TelegramLink() {
  const { t } = useI18n()

  const queryClient = useQueryClient()
  const [link, setLink] = useState<{ code: string; deepLink: string } | null>(
    null,
  )
  const status = useQuery({
    ...orpc.notifications.status.queryOptions(),
    // while waiting for the user to confirm in Telegram
    refetchInterval: link ? 3000 : false,
  })
  const linked = status.data?.linked ?? false
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.notifications.status.key() })

  const start = useMutation({
    mutationFn: () => orpc.notifications.startLink.call(),
    onSuccess: (data) => setLink(data),
    onError: (err) => toastError(t('دریافت کد انجام نشد'), err),
  })
  const unlink = useMutation({
    mutationFn: () => orpc.notifications.unlink.call(),
    onSuccess: async () => {
      setLink(null)
      await refresh()
      toastSuccess(t('اتصال تلگرام قطع شد'))
    },
    onError: (err) => toastError(t('قطع اتصال انجام نشد'), err),
  })
  const test = useMutation({
    mutationFn: () => orpc.notifications.sendTest.call(),
    onSuccess: () => toastSuccess(t('پیام آزمایشی ارسال شد')),
    onError: (err) => toastError(t('ارسال پیام انجام نشد'), err),
  })

  if (linked && link) setLink(null)

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <BellIcon className="size-4" /> {t('تلگرام')}
          </CardTitle>
          {status.data ? (
            <Badge variant={linked ? 'default' : 'outline'}>
              {linked ? t('متصل') : t('متصل نیست')}
            </Badge>
          ) : null}
        </div>
        <CardDescription>
          {t('اعلان‌ها به چت خصوصی شما با ربات ارسال می‌شود')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {status.error ? (
          <QueryErrorState
            error={status.error}
            onRetry={() => void status.refetch()}
          />
        ) : null}
        {status.data && !status.data.available ? (
          <p className="text-sm text-muted-foreground">
            {t('مدیر هنوز ربات تلگرام را فعال نکرده است.')}
          </p>
        ) : null}

        {status.data?.available && linked ? (
          <div className="space-y-4">
            {status.data.role === 'reseller' ? (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="font-medium">{t('مدیریت پنل از طریق ربات')}</p>
                <p className="mt-2 text-muted-foreground">
                  {t(
                    'دستورهای ربات: /menu، /wallet، /expiring، /renewals و /status نام‌کاربری',
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    'ربات فقط اطلاعات مشتریان خودتان را نمایش می‌دهد. برای تایید یا رد درخواست تمدید از پنل استفاده کنید.',
                  )}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                <SendIcon /> {t('ارسال پیام آزمایشی')}
              </Button>
              <Button
                variant="outline"
                disabled={unlink.isPending}
                onClick={() => unlink.mutate()}
              >
                {t('قطع اتصال')}
              </Button>
            </div>
          </div>
        ) : null}

        {status.data?.available && !linked ? (
          link ? (
            <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
              <p className="text-sm">
                {t(
                  'روی دکمه زیر بزنید و در تلگرام «Start» را بفشارید. این کد ۱۵ دقیقه معتبر است و فقط یک بار کار می‌کند.',
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  nativeButton={false}
                  render={
                    <a
                      href={link.deepLink}
                      target="_blank"
                      rel="noreferrer noopener"
                    />
                  }
                >
                  <ExternalLinkIcon /> {t('باز کردن در تلگرام')}
                </Button>
                <code
                  className="rounded bg-background px-2 py-1 font-mono text-sm"
                  dir="ltr"
                >
                  {link.code}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('کپی کد')}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(`/start ${link.code}`)
                      .then(() => toastSuccess(t('کپی شد')))
                  }
                >
                  <CopyIcon />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('در انتظار تایید در تلگرام…')}
              </p>
            </div>
          ) : (
            <Button disabled={start.isPending} onClick={() => start.mutate()}>
              {t('اتصال تلگرام')}
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  )
}

function TelegramAdmin() {
  const { t, numberLocale, formatDate } = useI18n()

  const queryClient = useQueryClient()
  const config = useQuery({
    ...orpc.notifications.adminConfig.queryOptions(),
    refetchInterval: 30_000,
  })
  const stats = useQuery({
    ...orpc.notifications.stats.queryOptions(),
    refetchInterval: 30_000,
  })
  const linkedAccounts = useQuery(
    orpc.notifications.linkedAccounts.queryOptions(),
  )
  const [token, setToken] = useState('')
  const [username, setUsername] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)

  const botUsername = username ?? config.data?.botUsername ?? ''
  const isEnabled = enabled ?? config.data?.enabled ?? false
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.notifications.adminConfig.key(),
    })

  const save = useMutation({
    mutationFn: () =>
      orpc.notifications.saveConfig.call({
        ...(token.trim() ? { botToken: token.trim() } : {}),
        botUsername,
        enabled: isEnabled,
      }),
    onSuccess: async () => {
      setToken('')
      setUsername(null)
      setEnabled(null)
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: orpc.notifications.status.key(),
        }),
      ])
      toastSuccess(t('تنظیمات ذخیره شد'))
    },
    onError: (err) => toastError(t('ذخیره انجام نشد'), err),
  })
  const register = useMutation({
    mutationFn: () => orpc.notifications.registerWebhook.call(),
    onSuccess: (r) =>
      toastSuccess(
        t('وب‌هوک ثبت شد'),
        r.username ? `@${r.username}` : undefined,
      ),
    onError: (err) => toastError(t('ثبت وب‌هوک انجام نشد'), err),
  })
  const adminUnlink = useMutation({
    mutationFn: (userId: string) =>
      orpc.notifications.adminUnlink.call({ userId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.notifications.linkedAccounts.key(),
      })
      toastSuccess(t('اتصال کاربر قطع شد'))
    },
    onError: (err) => toastError(t('قطع اتصال انجام نشد'), err),
  })

  const counts = stats.data?.counts ?? {}
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t('تنظیمات ربات (مدیر)')}</CardTitle>
        <CardDescription>
          {t(
            'ربات را در BotFather بسازید و توکن آن را اینجا وارد کنید. توکن رمزگذاری و فقط‌نوشتنی ذخیره می‌شود.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="tg-token">{t('توکن ربات')}</Label>
            <Input
              id="tg-token"
              dir="ltr"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                config.data?.configured
                  ? t('•••••• (برای تغییر وارد کنید)')
                  : '123456:ABC…'
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tg-user">{t('نام کاربری ربات')}</Label>
            <Input
              id="tg-user"
              dir="ltr"
              value={botUsername}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="my_vpn_bot"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isEnabled} onCheckedChange={setEnabled} />{' '}
          {t('فعال')}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              save.isPending ||
              botUsername.length < 3 ||
              (!config.data?.configured && token.trim().length < 10)
            }
            onClick={() => save.mutate()}
          >
            {t('ذخیره')}
          </Button>
          <Button
            variant="outline"
            disabled={register.isPending || !config.data?.configured}
            onClick={() => register.mutate()}
          >
            {t('ثبت وب‌هوک در تلگرام')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" dir="ltr">
          {config.data?.webhookUrl}
        </p>
        {config.data?.webhook ? (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
            <p>
              {t('وضعیت وب‌هوک:')}{' '}
              {t(
                (
                  {
                    matching: 'آدرس صحیح',
                    missing: 'ثبت نشده',
                    mismatch: 'آدرس متفاوت',
                    unreachable: 'بررسی ناموفق',
                    unconfigured: 'تنظیم نشده',
                  } as const
                )[config.data.webhook.state],
              )}
            </p>
            {config.data.webhook.pendingUpdateCount !== null ? (
              <p>
                {t('به‌روزرسانی‌های در انتظار:')}{' '}
                {config.data.webhook.pendingUpdateCount.toLocaleString(
                  numberLocale,
                )}
              </p>
            ) : null}
            {config.data.webhook.lastErrorMessage ? (
              <p className="text-destructive">
                {t('آخرین خطای تحویل:')}{' '}
                {config.data.webhook.lastErrorDate
                  ? `${formatDate(new Date(config.data.webhook.lastErrorDate * 1000).toISOString())} · `
                  : ''}
                {config.data.webhook.lastErrorMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4 text-sm">
          <Badge variant="outline">
            {t('در صف:')} {(counts.queued ?? 0).toLocaleString(numberLocale)}
          </Badge>
          <Badge variant="outline">
            {t('ارسال شده:')} {(counts.sent ?? 0).toLocaleString(numberLocale)}
          </Badge>
          <Badge variant="outline">
            {t('ناموفق نهایی:')}{' '}
            {(counts.dead ?? 0).toLocaleString(numberLocale)}
          </Badge>
          <Badge variant="outline">
            {t('بدون کانال:')}{' '}
            {(counts.skipped ?? 0).toLocaleString(numberLocale)}
          </Badge>
        </div>
        {(stats.data?.failures.length ?? 0) > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {stats.data!.failures.map((f) => (
              <li key={f.id} dir="ltr">
                {f.event} · {f.status} · {f.attempts}× · {f.lastError}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">{t('اتصال‌های فعال کاربران')}</p>
          {linkedAccounts.error ? (
            <QueryErrorState
              error={linkedAccounts.error}
              onRetry={() => void linkedAccounts.refetch()}
            />
          ) : linkedAccounts.data?.length ? (
            <ul className="divide-y rounded-md border">
              {linkedAccounts.data.map((account) => (
                <li
                  key={account.userId}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">
                      {account.name} · {account.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {account.role === 'reseller' ? t('فروشنده') : t('مدیر')} ·{' '}
                      {new Date(account.linkedAt).toLocaleDateString(
                        numberLocale,
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={adminUnlink.isPending}
                    onClick={() => adminUnlink.mutate(account.userId)}
                  >
                    <XIcon /> {t('قطع اتصال')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('حساب متصل‌شده‌ای وجود ندارد')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Branding() {
  const { t } = useI18n()

  const query = useQuery(orpc.customers.branding.queryOptions())
  const [name, setName] = useState<string | null>(null)
  const [support, setSupport] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      orpc.customers.setBranding.call({
        publicName: (name ?? query.data?.publicName ?? '').trim() || null,
        supportContact:
          (support ?? query.data?.supportContact ?? '').trim() || null,
      }),
    onSuccess: () => toastSuccess(t('ذخیره شد')),
    onError: (err) => toastError(t('ذخیره انجام نشد'), err),
  })
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t('صفحه مشتری')}</CardTitle>
        <CardDescription>
          {t(
            'نام و راه ارتباطی شما بالا و پایین صفحه‌ای که مشتری می‌بیند نمایش داده می‌شود',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pub-name">{t('نام نمایشی')}</Label>
            <Input
              id="pub-name"
              maxLength={60}
              value={name ?? query.data?.publicName ?? ''}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pub-support">{t('راه پشتیبانی')}</Label>
            <Input
              id="pub-support"
              maxLength={120}
              placeholder={t('@telegram یا شماره تماس')}
              value={support ?? query.data?.supportContact ?? ''}
              onChange={(e) => setSupport(e.target.value)}
            />
          </div>
        </div>
        <Button
          disabled={save.isPending || !query.data}
          onClick={() => save.mutate()}
        >
          {t('ذخیره')}
        </Button>
      </CardContent>
    </Card>
  )
}
