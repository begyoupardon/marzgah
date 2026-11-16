import { accessMessage } from '#/lib/access-messages'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '#/components/locale-provider'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { InboundPicker } from '#/components/access/inbound-picker'
import { AccessOperationPanel } from '#/components/access/access-operation'
import { getErrorMessage } from '#/lib/errors'
import type { AccessPolicy } from '#/lib/access-policy'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/admin/access')({
  beforeLoad: ({ context }) => {
    if (context.session?.user.role !== 'admin')
      throw redirect({ to: '/dashboard' })
  },
  component: AccessAdminPage,
})

function AccessAdminPage() {
  const { t } = useI18n()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previewRef = useRef<HTMLButtonElement>(null)
  const policyQuery = useQuery({
    ...orpc.access.policy.queryOptions({ input: { backend: 'marzban' } }),
    refetchOnWindowFocus: false,
  })
  const catalogQuery = useQuery(
    orpc.access.catalog.queryOptions({ input: { backend: 'marzban' } }),
  )
  const resellers = useQuery(orpc.admin.listResellers.queryOptions())
  const operations = useQuery(orpc.access.operations.queryOptions())
  const [draft, setDraft] = useState<AccessPolicy>()
  const [revision, setRevision] = useState(0)
  const [operationId, setOperationId] = useState<string>()
  const [key, setKey] = useState(() => crypto.randomUUID())
  const preview = useMutation(orpc.access.preview.mutationOptions())
  useEffect(() => {
    if (preview.data) confirmRef.current?.focus()
  }, [preview.data])
  useEffect(() => {
    if (policyQuery.data && !draft) {
      setDraft(policyQuery.data.policy)
      setRevision(policyQuery.data.revision)
    }
  }, [policyQuery.data, draft])
  const save = useMutation({
    ...orpc.access.savePolicy.mutationOptions(),
    onSuccess: async (result) => {
      setOperationId(result.operationId)
      preview.reset()
      const fresh = await policyQuery.refetch()
      if (fresh.data) {
        setDraft(fresh.data.policy)
        setRevision(fresh.data.revision)
      }
      void operations.refetch()
    },
  })
  function update(next: AccessPolicy) {
    setDraft(next)
    preview.reset()
    save.reset()
    setKey(crypto.randomUUID())
  }
  const catalog = catalogQuery.data?.inbounds ?? []
  const error =
    policyQuery.error ??
    catalogQuery.error ??
    resellers.error ??
    preview.error ??
    save.error
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('دسترسی اتصال')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('اینباندها، قالب‌ها و دسترسی الزامی کاربران را مدیریت کنید.')}
        </p>
      </header>
      {error && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive p-3 text-sm"
        >
          <p>{accessMessage(getErrorMessage(error), t)}</p>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const fresh = await policyQuery.refetch()
              if (fresh.data) setRevision(fresh.data.revision)
              await catalogQuery.refetch()
              await resellers.refetch()
              setKey(crypto.randomUUID())
              preview.reset()
              save.reset()
            }}
          >
            {t('تلاش مجدد')}
          </Button>
        </div>
      )}
      {!draft || catalogQuery.isPending ? (
        <p role="status">{t('در حال دریافت اینباندها…')}</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t('الزامی برای همه')}</h2>
            <p className="text-sm text-muted-foreground">
              {t(
                'به دسترسی همه کاربران فعلی و آینده افزوده می‌شود؛ وضعیت حساب تغییر نمی‌کند.',
              )}
            </p>
            <InboundPicker
              label={t('اینباندهای الزامی')}
              catalog={catalog}
              value={draft.required}
              onChange={(required) => update({ ...draft, required })}
              disabled={save.isPending}
            />
          </section>
          <details className="space-y-3 rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">
              {t('دسترسی پیش‌فرض نمایندگان')}
            </summary>
            <p className="text-sm text-muted-foreground">
              {t('اینباندهای جدید تا تأیید مدیر به نمایندگان اعطا نمی‌شوند.')}
            </p>
            <InboundPicker
              label={t('اینباندهای تأییدشده')}
              catalog={catalog}
              value={draft.approved}
              onChange={(approved) => update({ ...draft, approved })}
            />
          </details>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{t('قالب‌های دسترسی')}</h2>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  update({
                    ...draft,
                    templates: [
                      ...draft.templates,
                      {
                        id: crypto.randomUUID(),
                        name: t('قالب جدید'),
                        inbounds: [],
                      },
                    ],
                  })
                }
              >
                {t('افزودن قالب')}
              </Button>
            </div>
            {draft.templates.map((template, index) => (
              <details
                key={template.id}
                className="space-y-3 rounded-xl border p-4"
              >
                <summary className="cursor-pointer font-medium">
                  {template.name}
                </summary>
                <label className="block space-y-1 text-sm">
                  <span>{t('نام قالب')}</span>
                  <Input
                    value={template.name}
                    onChange={(e) =>
                      update({
                        ...draft,
                        templates: draft.templates.map((v, i) =>
                          i === index ? { ...v, name: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <InboundPicker
                  label={t('اینباندهای قالب')}
                  catalog={catalog}
                  value={template.inbounds}
                  onChange={(inbounds) =>
                    update({
                      ...draft,
                      templates: draft.templates.map((v, i) =>
                        i === index ? { ...v, inbounds } : v,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    update({
                      ...draft,
                      templates: draft.templates.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t('حذف قالب')}
                </Button>
              </details>
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t('سیاست نمایندگان')}</h2>
            {(resellers.data ?? []).map((reseller) => {
              const policy = draft.resellers.find(
                (r) => r.resellerId === reseller.id,
              )
              const current = policy ?? {
                resellerId: reseller.id,
                allowed: draft.approved,
                defaultTemplateId: null,
              }
              const change = (next: typeof current) =>
                update({
                  ...draft,
                  resellers: [
                    ...draft.resellers.filter(
                      (r) => r.resellerId !== reseller.id,
                    ),
                    next,
                  ],
                })
              return (
                <details
                  key={reseller.id}
                  className="space-y-3 rounded-xl border p-4"
                >
                  <summary className="cursor-pointer font-medium">
                    {reseller.name}
                  </summary>
                  <label className="block space-y-1 text-sm">
                    <span>{t('قالب پیش‌فرض')}</span>
                    <select
                      className="h-11 w-full rounded-lg border bg-background px-3"
                      value={current.defaultTemplateId ?? ''}
                      onChange={(e) =>
                        change({
                          ...current,
                          defaultTemplateId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">{t('پیش‌فرض VLESS')}</option>
                      {draft.templates.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <InboundPicker
                    label={t('اینباندهای مجاز نماینده')}
                    catalog={catalog}
                    value={current.allowed}
                    required={draft.required}
                    onChange={(allowed) => change({ ...current, allowed })}
                  />
                  {policy && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        update({
                          ...draft,
                          resellers: draft.resellers.filter(
                            (r) => r.resellerId !== reseller.id,
                          ),
                        })
                      }
                    >
                      {t('بازگشت به پیش‌فرض سامانه')}
                    </Button>
                  )}
                </details>
              )
            })}
          </section>
          <div className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
            {!preview.data ? (
              <Button
                ref={previewRef}
                type="button"
                disabled={preview.isPending || save.isPending}
                onClick={() =>
                  preview.mutate({ backend: 'marzban', policy: draft })
                }
              >
                {t('پیش‌نمایش تغییرات')}
              </Button>
            ) : (
              <section
                aria-label={t('تأیید تغییرات دسترسی')}
                className="space-y-3"
              >
                <p role="status">
                  {t('{0} کاربر تحت تأثیر قرار می‌گیرد', {
                    0: preview.data.affected,
                  })}
                </p>
                {preview.data.truncated && (
                  <p className="text-sm">
                    {t('نمایش {0} از {1} تغییر', {
                      0: preview.data.changes.length,
                      1: preview.data.affected,
                    })}
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t('جزئیات تغییرات')}
                  </summary>
                  <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
                    {preview.data.changes.map((change) => (
                      <li key={change.username} className="break-words">
                        <b dir="auto">{change.username}</b> ·{' '}
                        {change.legacy
                          ? t('انتخاب فعلی حفظ می‌شود و الزامات افزوده می‌شوند')
                          : `${change.before?.map((i) => i.tag).join(', ')} → ${change.after.map((i) => i.tag).join(', ')}`}
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button
                    ref={confirmRef}
                    type="button"
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate({
                        backend: 'marzban',
                        revision,
                        policy: draft,
                        idempotencyKey: key,
                      })
                    }
                  >
                    {t('تأیید و اعمال تغییرات')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => {
                      preview.reset()
                      requestAnimationFrame(() => previewRef.current?.focus())
                    }}
                  >
                    {t('انصراف')}
                  </Button>
                </div>
              </section>
            )}
          </div>
        </>
      )}
      {operationId && <AccessOperationPanel id={operationId} admin />}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('عملیات اخیر')}</h2>
        {(operations.data ?? [])
          .filter((op) => op.id !== operationId)
          .map((op) => (
            <OperationHistoryItem key={op.id} operation={op} />
          ))}
      </section>
    </div>
  )
}

function OperationHistoryItem({
  operation,
}: {
  operation: { id: string; createdAt: number; backend: string }
}) {
  const [open, setOpen] = useState(false)
  const { formatDate } = useI18n()
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer break-words text-sm" dir="auto">
        {formatDate(new Date(operation.createdAt))} · {operation.backend}
      </summary>
      {open && <AccessOperationPanel id={operation.id} admin />}
    </details>
  )
}
