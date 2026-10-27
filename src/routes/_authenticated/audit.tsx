import { useI18n } from '#/components/locale-provider'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { QueryErrorState } from '#/components/query-error-state'

import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/audit')({
  beforeLoad: async ({ context }) => {
    if (context.session?.user.role !== 'admin') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: AuditPage,
})

const ACTION_OPTIONS = [
  { value: 'all', label: 'همه رویدادها' },
  { value: 'vpn_user.create', label: 'ایجاد کاربر' },
  { value: 'vpn_user.renew', label: 'تمدید' },
  { value: 'vpn_user.extra_gb', label: 'افزایش حجم' },
  { value: 'vpn_user.update', label: 'ویرایش' },
  { value: 'vpn_user.reset_usage', label: 'ریست مصرف' },
  { value: 'vpn_user.revoke_sub', label: 'لغو اشتراک' },
  { value: 'vpn_user.sync', label: 'به‌روزرسانی' },
  { value: 'vpn_user.soft_remove', label: 'حذف نرم' },
  { value: 'billing.claim_paid', label: 'اعلام پرداخت' },
  { value: 'billing.settle', label: 'تسویه' },
  { value: 'billing.unsettle', label: 'برگشت تسویه' },
] as const

function actionLabel(action: string) {
  return ACTION_OPTIONS.find((o) => o.value === action)?.label ?? action
}

function actorRoleLabel(role: string) {
  if (role === 'admin') return 'مدیر'
  if (role === 'reseller') return 'نماینده'
  if (role === 'system') return 'سامانه'
  return role
}

function AuditPage() {
  const { t, formatDate } = useI18n()

  const [action, setAction] = useState('all')
  const [username, setUsername] = useState('')
  const [filterResellerId, setFilterResellerId] = useState('')

  const resellersQuery = useQuery(orpc.admin.listResellers.queryOptions())

  const auditQuery = useQuery(
    orpc.audit.list.queryOptions({
      input: {
        limit: 150,
        ...(action !== 'all' ? { action } : {}),
        ...(username.trim() ? { vpnUsername: username.trim() } : {}),
        ...(filterResellerId ? { resellerId: filterResellerId } : {}),
      },
    }),
  )

  const rows = useMemo(() => auditQuery.data ?? [], [auditQuery.data])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('رویدادها')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('ردپای ساخت، تمدید، تغییر وضعیت و تسویه برای نظارت بهتر')}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Select
          items={ACTION_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.label),
          }))}
          value={action}
          onValueChange={(value) => setAction(value ?? 'all')}
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder={t('نوع رویداد')} />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                label={t(opt.label)}
              >
                {t(opt.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-full sm:w-56"
          placeholder={t('نام کاربری')}
          dir="ltr"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Select
          items={(resellersQuery.data ?? []).map((r) => ({
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
            {(resellersQuery.data ?? []).map((r) => (
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
      </div>

      {auditQuery.error ? (
        <QueryErrorState
          error={auditQuery.error}
          onRetry={() => void auditQuery.refetch()}
        />
      ) : null}

      <div className="space-y-3">
        {rows.map((row) => (
          <article
            key={row.id}
            className="rounded-xl border bg-card p-4 shadow-xs"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {t(actionLabel(row.action))}
                  </Badge>
                  <Badge variant="outline">
                    {t(actorRoleLabel(row.actorRole))}
                  </Badge>
                </div>
                {row.vpnUsername ? (
                  <p className="font-mono text-sm" dir="ltr">
                    {row.vpnUsername}
                  </p>
                ) : null}
              </div>
              <time className="text-xs text-muted-foreground">
                {formatDate(row.createdAt)}
              </time>
            </div>
            {row.payload && typeof row.payload === 'object' ? (
              <pre
                className="mt-3 overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"
                dir="ltr"
              >
                {JSON.stringify(row.payload, null, 2)}
              </pre>
            ) : null}
          </article>
        ))}
        {!auditQuery.isLoading && rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {t('رویدادی ثبت نشده است')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
