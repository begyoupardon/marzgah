import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ActivityIcon,
  ArrowLeftIcon,
  CheckIcon,
  LayersIcon,
  PlusIcon,
  ServerIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react'
import { useI18n } from '#/components/locale-provider'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#/components/ui/dialog'
import {
  HostPicker,
  selectedHostCount,
  SelectionCheckbox,
} from '#/components/access/host-picker'
import { AccessOperationPanel } from '#/components/access/access-operation'
import { accessMessage } from '#/lib/access-messages'
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
type Tab = 'hosts' | 'templates' | 'resellers' | 'activity'
const selectClass =
  'h-10 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring'
function AccessAdminPage() {
  const { t, direction } = useI18n()
  const policy = useQuery({
    ...orpc.access.policy.queryOptions({ input: { backend: 'marzban' } }),
    refetchOnWindowFocus: false,
  })
  const catalogQuery = useQuery(
    orpc.access.catalog.queryOptions({ input: { backend: 'marzban' } }),
  )
  const resellers = useQuery(orpc.admin.listResellers.queryOptions())
  const operations = useQuery(orpc.access.operations.queryOptions())
  const [editing, setEditing] = useState<AccessPolicy>()
  const draft = editing ?? policy.data?.policy
  const [tab, setTab] = useState<Tab>('hosts')
  const [scope, setScope] = useState<'approved' | 'required'>('approved')
  const [templateId, setTemplateId] = useState<string>()
  const [resellerQuery, setResellerQuery] = useState('')
  const [checkedResellers, setCheckedResellers] = useState<string[]>([])
  const [bulkTemplate, setBulkTemplate] = useState('')
  const [editingReseller, setEditingReseller] = useState<string>()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [operationId, setOperationId] = useState<string>()
  const [key, setKey] = useState(() => crypto.randomUUID())
  const preview = useMutation({
    ...orpc.access.preview.mutationOptions(),
    onSuccess: () => setReviewOpen(true),
  })
  const save = useMutation({
    ...orpc.access.savePolicy.mutationOptions(),
    onSuccess: async (result) => {
      setOperationId(result.operationId)
      setReviewOpen(false)
      setEditing(undefined)
      preview.reset()
      setKey(crypto.randomUUID())
      await policy.refetch()
      void operations.refetch()
    },
  })
  const busy = preview.isPending || save.isPending
  const catalog = catalogQuery.data?.inbounds ?? []
  const hosts = catalog.flatMap((i) => i.hosts).filter((h) => !h.disabled)
  const dirty =
    draft && policy.data
      ? JSON.stringify(draft) !== JSON.stringify(policy.data.policy)
      : false
  const error =
    policy.error ??
    catalogQuery.error ??
    resellers.error ??
    preview.error ??
    save.error
  const template =
    draft?.templates.find((item) => item.id === templateId) ??
    draft?.templates[0]
  const visibleResellers = (resellers.data ?? []).filter((r) =>
    `${r.name} ${r.email}`.toLowerCase().includes(resellerQuery.toLowerCase()),
  )
  const selectedVisible = visibleResellers.filter((r) =>
    checkedResellers.includes(r.id),
  ).length
  function update(next: AccessPolicy) {
    setEditing(next)
    preview.reset()
    save.reset()
    setReviewOpen(false)
    setKey(crypto.randomUUID())
  }
  function assign(ids: string[], id: string) {
    if (!draft) return
    const selected = draft.templates.find((item) => item.id === id)
    if (!selected) return
    update({
      ...draft,
      resellers: [
        ...draft.resellers.filter((r) => !ids.includes(r.resellerId)),
        ...ids.map((resellerId) => ({
          resellerId,
          allowed: selected.inbounds,
          defaultTemplateId: id,
          assignmentId: crypto.randomUUID(),
        })),
      ],
    })
  }
  const tabs = [
    { id: 'hosts' as const, title: t('میزبان‌ها'), icon: ServerIcon },
    { id: 'templates' as const, title: t('قالب‌ها'), icon: LayersIcon },
    { id: 'resellers' as const, title: t('تخصیص نمایندگان'), icon: UsersIcon },
    { id: 'activity' as const, title: t('فعالیت‌ها'), icon: ActivityIcon },
  ]
  return (
    <div
      className="w-full min-w-0 space-y-6 pb-8"
      data-testid="access-workspace"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <ShieldCheckIcon className="size-4" aria-hidden />
            {t('مدیریت اختصاصی مدیر')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('مدیریت میزبان‌ها')}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t(
              'میزبان‌ها را جداگانه انتخاب کنید، قالب بسازید و به نمایندگان اختصاص دهید. تنظیمات برای نمایندگان نمایش داده نمی‌شود.',
            )}
          </p>
        </div>
        <Button
          type="button"
          className="h-10 gap-2"
          disabled={!dirty || busy}
          onClick={() =>
            draft && preview.mutate({ backend: 'marzban', policy: draft })
          }
        >
          <CheckIcon className="size-4" aria-hidden />
          {t('بازبینی و ذخیره')}
        </Button>
      </header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: t('میزبان‌های موجود'),
            count: hosts.length,
            icon: ServerIcon,
          },
          {
            label: t('قالب‌های دسترسی'),
            count: draft?.templates.length ?? 0,
            icon: LayersIcon,
          },
          {
            label: t('نمایندگان دارای قالب'),
            count:
              draft?.resellers.filter((r) => r.defaultTemplateId).length ?? 0,
            icon: UsersIcon,
          },
          {
            label: t('الزامی برای همه'),
            count: draft ? selectedHostCount(catalog, draft.required) : 0,
            icon: ShieldCheckIcon,
          },
        ].map(({ label, count, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border bg-card p-4"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Icon className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{count}</p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>{accessMessage(getErrorMessage(error), t)}</p>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await policy.refetch()
              await catalogQuery.refetch()
              await resellers.refetch()
              preview.reset()
              save.reset()
              setKey(crypto.randomUUID())
            }}
          >
            {t('تلاش مجدد')}
          </Button>
        </div>
      )}
      {catalogQuery.data && !catalogQuery.data.hostsAvailable && (
        <p role="alert" className="rounded-xl border bg-muted p-4 text-sm">
          {t(
            'دریافت میزبان‌ها ممکن نیست. دسترسی حساب سرور را بررسی کنید؛ انتخاب میزبان تا دریافت فهرست غیرفعال است.',
          )}
        </p>
      )}
      <div
        role="tablist"
        aria-label={t('بخش‌های مدیریت میزبان')}
        className="flex overflow-x-auto border-b"
      >
        {tabs.map(({ id, title, icon: Icon }, index) => (
          <button
            type="button"
            key={id}
            id={`access-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`access-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors ${tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'} focus-visible:outline-2 focus-visible:outline-ring`}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              let next = index
              if (e.key === 'Home') next = 0
              else if (e.key === 'End') next = tabs.length - 1
              else if (e.key === 'ArrowRight')
                next =
                  (index + (direction === 'rtl' ? tabs.length - 1 : 1)) %
                  tabs.length
              else if (e.key === 'ArrowLeft')
                next =
                  (index + (direction === 'rtl' ? 1 : tabs.length - 1)) %
                  tabs.length
              else return
              e.preventDefault()
              setTab(tabs[next]!.id)
              document.getElementById(`access-tab-${tabs[next]!.id}`)?.focus()
            }}
          >
            <Icon className="size-4" aria-hidden />
            {title}
          </button>
        ))}
      </div>
      {!draft || catalogQuery.isPending ? (
        <p role="status" className="p-8 text-center">
          {t('در حال دریافت میزبان‌ها…')}
        </p>
      ) : (
        <div
          role="tabpanel"
          id={`access-panel-${tab}`}
          aria-labelledby={`access-tab-${tab}`}
          className="min-w-0 space-y-5"
        >
          {tab === 'hosts' && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {t('انتخاب میزبان‌ها')}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {scope === 'approved'
                      ? t('انتخاب پیش‌فرض برای کاربرانی که قالب اختصاصی ندارند.')
                      : t(
                          'این میزبان‌ها به انتخاب همه کاربران فعلی و آینده افزوده می‌شوند.',
                        )}
                  </p>
                </div>
                <label className="min-w-52 space-y-1 text-xs font-medium">
                  <span>{t('اعمال انتخاب برای')}</span>
                  <select
                    aria-label={t('اعمال انتخاب برای')}
                    className={selectClass}
                    value={scope}
                    onChange={(e) => setScope(e.target.value as typeof scope)}
                  >
                    <option value="approved">{t('پیش‌فرض سامانه')}</option>
                    <option value="required">{t('الزامی برای همه')}</option>
                  </select>
                </label>
              </div>
              <HostPicker
                label={
                  scope === 'approved'
                    ? t('میزبان‌های پیش‌فرض')
                    : t('میزبان‌های الزامی')
                }
                catalog={catalog}
                value={
                  scope === 'approved' && !draft.hostDefaults
                    ? draft.approved.filter((i) => i.protocol === 'vless')
                    : draft[scope]
                }
                disabled={busy || !catalogQuery.data?.hostsAvailable}
                onChange={(value) =>
                  update({
                    ...draft,
                    [scope]: value,
                    ...(scope === 'approved' ? { hostDefaults: true } : {}),
                  })
                }
              />
              <p className="text-xs leading-6 text-muted-foreground">
                {t(
                  'انتخاب میزبان، محتوای لینک اشتراک را کنترل می‌کند. برای کاربران قبلی، لینک جدید پنل را در برنامه اشتراک وارد کنید.',
                )}
              </p>
            </>
          )}
          {tab === 'templates' && (
            <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
              <aside className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{t('قالب‌های دسترسی')}</h2>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={busy}
                    onClick={() => {
                      const id = crypto.randomUUID()
                      update({
                        ...draft,
                        templates: [
                          ...draft.templates,
                          { id, name: t('قالب جدید'), inbounds: [] },
                        ],
                      })
                      setTemplateId(id)
                    }}
                  >
                    <PlusIcon className="size-4" aria-hidden />
                    {t('قالب جدید')}
                  </Button>
                </div>
                <div className="space-y-2">
                  {draft.templates.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={template?.id === item.id}
                      className={`w-full rounded-xl border p-4 text-start transition-colors focus-visible:outline-2 focus-visible:outline-ring ${template?.id === item.id ? 'border-primary/40 bg-primary/5' : 'bg-card hover:bg-muted/40'}`}
                      onClick={() => setTemplateId(item.id)}
                    >
                      <span className="block break-words font-medium">
                        {item.name}
                      </span>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {t('{0} میزبان · {1} نماینده', {
                          0: selectedHostCount(catalog, item.inbounds),
                          1: draft.resellers.filter(
                            (r) => r.defaultTemplateId === item.id,
                          ).length,
                        })}
                      </span>
                    </button>
                  ))}
                </div>
                {!draft.templates.length && (
                  <p className="rounded-xl border border-dashed p-5 text-sm leading-6 text-muted-foreground">
                    {t(
                      'یک قالب بسازید، میزبان‌های آن را انتخاب کنید و سپس آن را به نمایندگان اختصاص دهید.',
                    )}
                  </p>
                )}
              </aside>
              <div className="min-w-0 space-y-4">
                {template ? (
                  <>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-48 flex-1 space-y-1 text-sm font-medium">
                        <span>{t('نام قالب')}</span>
                        <Input
                          className="h-10"
                          value={template.name}
                          disabled={busy}
                          onChange={(e) =>
                            update({
                              ...draft,
                              templates: draft.templates.map((item) =>
                                item.id === template.id
                                  ? { ...item, name: e.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 gap-2"
                        disabled={busy}
                        onClick={() => {
                          setBulkTemplate(template.id)
                          setTab('resellers')
                        }}
                      >
                        <UsersIcon className="size-4" aria-hidden />
                        {t('تخصیص به نمایندگان')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10 text-destructive"
                        disabled={
                          busy ||
                          draft.resellers.some(
                            (r) => r.defaultTemplateId === template.id,
                          )
                        }
                        aria-label={t('حذف قالب')}
                        onClick={() =>
                          update({
                            ...draft,
                            templates: draft.templates.filter(
                              (item) => item.id !== template.id,
                            ),
                          })
                        }
                      >
                        <Trash2Icon className="size-4" aria-hidden />
                      </Button>
                    </div>
                    <HostPicker
                      label={t('میزبان‌های قالب')}
                      catalog={catalog}
                      value={template.inbounds}
                      disabled={busy}
                      onChange={(inbounds) =>
                        update({
                          ...draft,
                          templates: draft.templates.map((item) =>
                            item.id === template.id
                              ? { ...item, inbounds }
                              : item,
                          ),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('تغییرات قالب برای کاربران مرتبط نیز اعمال می‌شود.')}
                    </p>
                  </>
                ) : (
                  <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {t('برای شروع یک قالب جدید بسازید.')}
                  </div>
                )}
              </div>
            </div>
          )}
          {tab === 'resellers' && (
            <>
              <div>
                <h2 className="text-lg font-semibold">
                  {t('تخصیص میزبان و قالب به نمایندگان')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    'تخصیص جدید روی کاربران فعلی و آینده نماینده اعمال می‌شود. نماینده این تنظیمات را نمی‌بیند و نمی‌تواند تغییر دهد.',
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/20 p-4">
                <label className="min-w-44 flex-1 space-y-1 text-xs font-medium">
                  <span>{t('جستجوی نماینده')}</span>
                  <Input
                    className="h-10"
                    value={resellerQuery}
                    onChange={(e) => setResellerQuery(e.target.value)}
                  />
                </label>
                <label className="min-w-44 flex-1 space-y-1 text-xs font-medium">
                  <span>{t('قالب برای تخصیص گروهی')}</span>
                  <select
                    aria-label={t('قالب برای تخصیص گروهی')}
                    className={selectClass}
                    value={bulkTemplate}
                    onChange={(e) => setBulkTemplate(e.target.value)}
                  >
                    <option value="">{t('انتخاب قالب')}</option>
                    {draft.templates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  className="h-10"
                  disabled={busy || !bulkTemplate || !checkedResellers.length}
                  onClick={() => assign(checkedResellers, bulkTemplate)}
                >
                  {t('تخصیص به {0} نماینده', { 0: checkedResellers.length })}
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-start text-sm">
                  <caption className="sr-only">{t('تخصیص نمایندگان')}</caption>
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="w-12 px-4 py-3">
                        <SelectionCheckbox
                          aria-label={t('انتخاب همه نمایندگان نمایان')}
                          checked={
                            selectedVisible > 0 &&
                            selectedVisible === visibleResellers.length
                          }
                          mixed={
                            selectedVisible > 0 &&
                            selectedVisible < visibleResellers.length
                          }
                          onChange={(e) =>
                            setCheckedResellers(
                              e.target.checked
                                ? [
                                    ...new Set([
                                      ...checkedResellers,
                                      ...visibleResellers.map((r) => r.id),
                                    ]),
                                  ]
                                : checkedResellers.filter(
                                    (id) =>
                                      !visibleResellers.some(
                                        (r) => r.id === id,
                                      ),
                                  ),
                            )
                          }
                        />
                      </th>
                      <th className="px-3 py-3 text-start">{t('نماینده')}</th>
                      <th className="min-w-44 px-3 py-3 text-start">
                        {t('قالب تخصیص‌یافته')}
                      </th>
                      <th className="px-3 py-3 text-start">{t('میزبان‌ها')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleResellers.map((reseller) => {
                      const setting = draft.resellers.find(
                        (r) => r.resellerId === reseller.id,
                      )
                      const selected = draft.templates.find(
                        (item) => item.id === setting?.defaultTemplateId,
                      )
                      return (
                        <tr
                          key={reseller.id}
                          className={
                            checkedResellers.includes(reseller.id)
                              ? 'bg-primary/5'
                              : ''
                          }
                        >
                          <td className="px-4 py-3">
                            <SelectionCheckbox
                              aria-label={`${t('انتخاب نماینده')} ${reseller.name}`}
                              checked={checkedResellers.includes(reseller.id)}
                              onChange={(e) =>
                                setCheckedResellers(
                                  e.target.checked
                                    ? [...checkedResellers, reseller.id]
                                    : checkedResellers.filter(
                                        (id) => id !== reseller.id,
                                      ),
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-3">
                            <span className="block font-medium" dir="auto">
                              {reseller.name}
                            </span>
                            <span
                              className="mt-1 block text-xs text-muted-foreground"
                              dir="ltr"
                            >
                              {reseller.email}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <select
                              aria-label={`${t('قالب نماینده')} ${reseller.name}`}
                              className={selectClass}
                              disabled={busy}
                              value={setting?.defaultTemplateId ?? ''}
                              onChange={(e) => {
                                if (e.target.value)
                                  assign([reseller.id], e.target.value)
                                else {
                                  update({
                                    ...draft,
                                    resellers: [
                                      ...draft.resellers.filter(
                                        (r) => r.resellerId !== reseller.id,
                                      ),
                                      {
                                        resellerId: reseller.id,
                                        allowed:
                                          selected?.inbounds ??
                                          setting?.allowed ??
                                          draft.approved,
                                        defaultTemplateId: null,
                                        assignmentId: crypto.randomUUID(),
                                      },
                                    ],
                                  })
                                  setEditingReseller(reseller.id)
                                }
                              }}
                            >
                              <option value="">
                                {setting?.assignmentId
                                  ? t('انتخاب سفارشی')
                                  : t('پیش‌فرض سامانه')}
                              </option>
                              {draft.templates.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setEditingReseller(
                                  editingReseller === reseller.id
                                    ? undefined
                                    : reseller.id,
                                )
                              }
                            >
                              {t('انتخاب میزبان‌ها')}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!visibleResellers.length && (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {t('نماینده‌ای پیدا نشد')}
                  </p>
                )}
              </div>
              {editingReseller &&
                (() => {
                  const row = resellers.data?.find(
                    (r) => r.id === editingReseller,
                  )
                  const setting = draft.resellers.find(
                    (r) => r.resellerId === editingReseller,
                  )
                  const selected = draft.templates.find(
                    (item) => item.id === setting?.defaultTemplateId,
                  )
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold">
                          {t('انتخاب سفارشی برای {0}', { 0: row?.name ?? '' })}
                        </h3>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingReseller(undefined)}
                        >
                          {t('بستن')}
                        </Button>
                      </div>
                      <HostPicker
                        label={t('میزبان‌های نماینده')}
                        catalog={catalog}
                        value={
                          selected?.inbounds ??
                          setting?.allowed ??
                          draft.approved
                        }
                        required={draft.required}
                        disabled={busy}
                        onChange={(allowed) =>
                          update({
                            ...draft,
                            resellers: [
                              ...draft.resellers.filter(
                                (r) => r.resellerId !== editingReseller,
                              ),
                              {
                                resellerId: editingReseller,
                                allowed,
                                defaultTemplateId: null,
                                assignmentId: crypto.randomUUID(),
                              },
                            ],
                          })
                        }
                      />
                    </div>
                  )
                })()}
            </>
          )}
          {tab === 'activity' && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">{t('عملیات اخیر')}</h2>
              {operationId && <AccessOperationPanel id={operationId} admin />}
              {(operations.data ?? [])
                .filter((op) => op.id !== operationId)
                .map((op) => (
                  <OperationHistoryItem key={op.id} operation={op} />
                ))}
              {!operations.data?.length && !operationId && (
                <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {t('هنوز عملیاتی ثبت نشده است.')}
                </p>
              )}
            </section>
          )}
        </div>
      )}
      {dirty && (
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur-sm md:sticky md:bottom-3">
          <p className="text-sm font-medium">{t('تغییرات ذخیره‌نشده دارید')}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(undefined)
                preview.reset()
                save.reset()
              }}
            >
              {t('کنار گذاشتن تغییرات')}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                draft && preview.mutate({ backend: 'marzban', policy: draft })
              }
            >
              {t('بازبینی و ذخیره')}
            </Button>
          </div>
        </div>
      )}
      {operationId && tab !== 'activity' && (
        <div className="space-y-3">
          <AccessOperationPanel id={operationId} admin />
          <Button
            type="button"
            variant="ghost"
            className="gap-2"
            onClick={() => setTab('activity')}
          >
            {t('مشاهده همه فعالیت‌ها')}
            <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
      )}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('بازبینی تغییرات میزبان')}</DialogTitle>
            <DialogDescription>
              {t(
                'انتخاب‌ها پس از تأیید ذخیره می‌شوند و برای کاربران در پس‌زمینه اعمال می‌شوند.',
              )}
            </DialogDescription>
          </DialogHeader>
          {preview.data && (
            <>
              <p
                className="rounded-xl bg-primary/5 p-4 text-base font-semibold"
                role="status"
              >
                {t('{0} کاربر تحت تأثیر قرار می‌گیرد', {
                  0: preview.data.affected,
                })}
              </p>
              <div className="max-h-72 overflow-y-auto rounded-xl border">
                <ul className="divide-y">
                  {preview.data.changes.map((change) => (
                    <li
                      key={change.username}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                    >
                      <span className="font-mono" dir="ltr">
                        {change.username}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('{0} میزبان در انتخاب جدید', {
                          0: selectedHostCount(catalog, change.after),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {preview.data.truncated && (
                <p className="text-xs text-muted-foreground">
                  {t('نمایش {0} از {1} تغییر', {
                    0: preview.data.changes.length,
                    1: preview.data.affected,
                  })}
                </p>
              )}
              <p className="text-xs leading-6 text-muted-foreground">
                {t(
                  'وضعیت حساب، حجم، تاریخ انقضا و صورتحساب تغییر نمی‌کند. کاربران قبلی باید از لینک اشتراک جدید پنل استفاده کنند.',
                )}
              </p>
            </>
          )}
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {accessMessage(getErrorMessage(save.error), t)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => setReviewOpen(false)}
            >
              {t('بازگشت به ویرایش')}
            </Button>
            <Button
              type="button"
              disabled={save.isPending || !draft || !preview.data}
              onClick={() =>
                draft &&
                preview.data &&
                save.mutate({
                  backend: 'marzban',
                  policy: draft,
                  revision: preview.data.revision,
                  idempotencyKey: key,
                })
              }
            >
              {save.isPending ? t('در حال ذخیره…') : t('تأیید و اعمال تغییرات')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <details
      className="rounded-xl border bg-card p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm">
        {formatDate(new Date(operation.createdAt))} · {operation.backend}
      </summary>
      {open && (
        <div className="mt-4">
          <AccessOperationPanel id={operation.id} admin />
        </div>
      )}
    </details>
  )
}
