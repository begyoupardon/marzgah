import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { CopyIcon, KeyRoundIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { QueryErrorState } from '#/components/query-error-state'
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/api-keys')({
  component: ApiKeysPage,
})

function ApiKeysPage() {
  const { t, formatDate } = useI18n()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [days, setDays] = useState<30 | 90 | 365>(90)
  const [secret, setSecret] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const keys = useQuery(orpc.apiKeys.list.queryOptions())
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.apiKeys.list.key() })
  const create = useMutation({
    mutationFn: () =>
      orpc.apiKeys.create.call({ name: name.trim(), expiresInDays: days }),
    onSuccess: async (result) => {
      setName('')
      setSecret(result.token)
      await refresh()
      toastSuccess(t('کلید API ساخته شد'))
    },
    onError: (error) => toastError(t('ساخت کلید انجام نشد'), error),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => orpc.apiKeys.revoke.call({ id }),
    onSuccess: async () => {
      setRevokeId(null)
      await refresh()
      toastSuccess(t('کلید API لغو شد'))
    },
    onError: (error) => toastError(t('لغو کلید انجام نشد'), error),
  })
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toastSuccess(t('کپی شد'))
    } catch (error) {
      toastError(t('کپی انجام نشد'), error)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <KeyRoundIcon className="size-6" />
          {t('کلیدهای API')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'برای هر عامل یا ابزار یک کلید جدا بسازید. هر کلید دسترسی‌های فعلی حساب شما را دارد.',
          )}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('ساخت کلید جدید')}</CardTitle>
          <CardDescription>
            {t(
              'کلید فقط یک بار نمایش داده می‌شود. آن را در محل امن نگهداری کنید.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="api-key-name">{t('نام کلید')}</Label>
              <Input
                id="api-key-name"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('مثلاً عامل فروش')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key-expiry">{t('اعتبار')}</Label>
              <select
                id="api-key-expiry"
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={days}
                onChange={(event) =>
                  setDays(Number(event.target.value) as 30 | 90 | 365)
                }
              >
                <option value={30}>{t('۳۰ روز')}</option>
                <option value={90}>{t('۹۰ روز')}</option>
                <option value={365}>{t('۳۶۵ روز')}</option>
              </select>
            </div>
            <Button
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? t('در حال ایجاد…') : t('ساخت کلید')}
            </Button>
          </div>
        </CardContent>
      </Card>
      {secret && (
        <Card className="border-primary/50" role="status">
          <CardHeader>
            <CardTitle>{t('کلید جدید شما')}</CardTitle>
            <CardDescription>
              {t('این کلید پس از بستن این بخش دوباره قابل مشاهده نیست.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                readOnly
                dir="ltr"
                aria-label={t('کلید جدید شما')}
                value={secret}
                className="min-w-0 flex-1 font-mono"
              />
              <Button variant="outline" onClick={() => void copy(secret)}>
                <CopyIcon />
                {t('کپی کلید')}
              </Button>
            </div>
            <Button variant="secondary" onClick={() => setSecret(null)}>
              {t('کلید را ذخیره کردم')}
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('کلیدهای من')}</CardTitle>
          <CardDescription>
            {t('کلیدهای لغوشده یا منقضی‌شده قابل استفاده نیستند.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keys.error && (
            <QueryErrorState
              error={keys.error}
              onRetry={() => void keys.refetch()}
            />
          )}
          {keys.isLoading && (
            <p className="text-sm text-muted-foreground">
              {t('در حال بارگذاری…')}
            </p>
          )}
          {keys.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('هنوز کلیدی ساخته نشده است.')}
            </p>
          )}
          <div className="divide-y">
            {keys.data?.map((key) => {
              const status = key.revokedAt
                ? t('لغوشده')
                : new Date(key.expiresAt) <= new Date()
                  ? t('منقضی شده')
                  : t('فعال')
              return (
                <div
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span dir="auto" className="font-medium break-all">
                        {key.name}
                      </span>
                      <Badge
                        variant={status === t('فعال') ? 'default' : 'outline'}
                      >
                        {status}
                      </Badge>
                    </div>
                    <dl className="mt-2 grid gap-x-5 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                      <div>
                        <dt className="inline">{t('ساخته‌شده')}: </dt>
                        <dd dir="auto" className="inline">
                          {formatDate(key.createdAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">{t('انقضا')}: </dt>
                        <dd dir="auto" className="inline">
                          {formatDate(key.expiresAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">{t('آخرین استفاده')}: </dt>
                        <dd dir="auto" className="inline">
                          {key.lastUsedAt
                            ? formatDate(key.lastUsedAt)
                            : t('هرگز')}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  {!key.revokedAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRevokeId(key.id)}
                    >
                      <Trash2Icon />
                      {t('لغو کلید')}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
      <div className="text-sm">
        <a
          href="/api/"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          {t('مرجع تعاملی API')}
        </a>
        <span className="mx-2">·</span>
        <a
          href="/api/spec.json"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          OpenAPI JSON
        </a>
      </div>
      <AlertDialog
        open={revokeId !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('لغو کلید API')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'عامل‌هایی که از این کلید استفاده می‌کنند فوراً دسترسی خود را از دست می‌دهند.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>
              {t('انصراف')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={() => {
                if (revokeId) revoke.mutate(revokeId)
              }}
            >
              {t('لغو کلید')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
