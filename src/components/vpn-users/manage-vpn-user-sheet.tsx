import { useI18n } from '#/components/locale-provider'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { Button } from '#/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import {
  DataLimitField,
  DurationMonthsField,
} from '#/components/vpn-users/plan-fields'
import { ResponsiveFormShell } from '#/components/vpn-users/responsive-form-shell'
import { SubscriptionShareDialog } from '#/components/vpn-users/subscription-share-dialog'
import { getErrorMessage } from '#/lib/errors'
import { statusColor, statusLabel } from '#/lib/format'
import { toastError, toastSuccess } from '#/lib/toast'
import {
  bytesToGb,
  DURATION_MONTHS,
  durationLabel,
  editVpnUserFormSchema,
  gbToBytes,
  renewExpireAt,
  renewVpnUserFormSchema,
  UNLIMITED_DURATION,
} from '#/lib/vpn-plans'
import type {
  DurationChoice,
  EditVpnUserFormValues,
  RenewVpnUserFormValues,
} from '#/lib/vpn-plans'
import { orpc } from '#/orpc/client'

export type ManageVpnUser = {
  id: string
  marzbanUsername: string
  status: string
  dataLimitBytes: number | null
  usedTrafficBytes: number
  expireAt: string | null
  note: string | null
  subscriptionUrl: string | null
  resellerId?: string
}

type ManageMode = 'edit' | 'renew'

const EDIT_FORM_ID = 'manage-vpn-edit-form'
const RENEW_FORM_ID = 'manage-vpn-renew-form'

export function ManageVpnUserSheet({
  user,
  open,
  onOpenChange,
  pricePerGbToman,
  allowUnlimitedExpire = false,
  onSuccess,
}: {
  user: ManageVpnUser | null
  open: boolean
  onOpenChange: (open: boolean) => void
  pricePerGbToman?: number | null
  allowUnlimitedExpire?: boolean
  onSuccess: () => void | Promise<unknown>
}) {
  const { t, formatBytes, formatDate, formatToman } = useI18n()

  const [mode, setMode] = useState<ManageMode>('renew')
  const [shareOpen, setShareOpen] = useState(false)

  const editForm = useForm<EditVpnUserFormValues>({
    resolver: zodResolver(editVpnUserFormSchema),
    defaultValues: { dataLimitGb: 25, note: '', password: '' },
    mode: 'onTouched',
  })

  const renewForm = useForm<RenewVpnUserFormValues>({
    resolver: zodResolver(renewVpnUserFormSchema),
    defaultValues: {
      durationMonths: 1,
      dataLimitGb: 25,
      resetUsage: true,
      reactivate: true,
    },
    mode: 'onTouched',
  })

  useEffect(() => {
    if (!open || !user) return
    setMode('renew')
    editForm.clearErrors()
    renewForm.clearErrors()
    const gb = bytesToGb(user.dataLimitBytes) ?? 25
    editForm.reset({ dataLimitGb: gb, note: user.note ?? '', password: '' })
    renewForm.reset({
      durationMonths: 1,
      dataLimitGb: gb,
      resetUsage: true,
      reactivate: true,
    })
  }, [open, user, editForm, renewForm])

  const editMutation = useMutation({
    ...orpc.vpnUsers.update.mutationOptions(),
    onSuccess: async (_data, vars) => {
      onOpenChange(false)
      await onSuccess()
      toastSuccess(t('کاربر ویرایش شد'), vars.username)
    },
    onError: (err) => {
      editForm.setError('root', { message: t(getErrorMessage(err)) })
      toastError(t('ویرایش کاربر انجام نشد'), err)
    },
  })

  const renewMutation = useMutation({
    ...orpc.vpnUsers.renew.mutationOptions(),
    onSuccess: async (_data, vars) => {
      onOpenChange(false)
      await onSuccess()
      toastSuccess(t('کاربر تمدید شد'), vars.username)
    },
    onError: (err) => {
      renewForm.setError('root', { message: t(getErrorMessage(err)) })
      toastError(t('تمدید کاربر انجام نشد'), err)
    },
  })

  const renewDuration = useWatch({
    control: renewForm.control,
    name: 'durationMonths',
  })
  const renewGb = useWatch({ control: renewForm.control, name: 'dataLimitGb' })

  const durationOptions: DurationChoice[] = allowUnlimitedExpire
    ? [...DURATION_MONTHS, UNLIMITED_DURATION]
    : [...DURATION_MONTHS]

  const renewPreview = useMemo(
    () => renewExpireAt(user?.expireAt, renewDuration || 1),
    [user?.expireAt, renewDuration],
  )

  const renewPrice =
    pricePerGbToman != null &&
    typeof renewGb === 'number' &&
    !Number.isNaN(renewGb)
      ? renewGb * pricePerGbToman
      : null

  const pending = editMutation.isPending || renewMutation.isPending
  const activeFormId = mode === 'edit' ? EDIT_FORM_ID : RENEW_FORM_ID

  function onEditSubmit(values: EditVpnUserFormValues) {
    if (!user) return
    editForm.clearErrors('root')
    const password = values.password?.trim()
    editMutation.mutate({
      username: user.marzbanUsername,
      dataLimitBytes: gbToBytes(values.dataLimitGb),
      note: values.note?.trim() || null,
      ...(password ? { password } : {}),
    })
  }

  function onRenewSubmit(values: RenewVpnUserFormValues) {
    if (!user) return
    renewForm.clearErrors('root')
    renewMutation.mutate({
      username: user.marzbanUsername,
      durationMonths: values.durationMonths,
      dataLimitBytes: gbToBytes(values.dataLimitGb),
      resetUsage: values.resetUsage,
      reactivate: values.reactivate,
    })
  }

  return (
    <>
      <ResponsiveFormShell
        open={open}
        onOpenChange={onOpenChange}
        title={t('مدیریت کاربر')}
        description={t('ویرایش حجم یا تمدید اشتراک')}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-8"
              onClick={() => onOpenChange(false)}
            >
              {t('انصراف')}
            </Button>
            <Button
              type="submit"
              form={activeFormId}
              className="h-11 sm:h-8"
              disabled={pending || !user}
            >
              {pending
                ? mode === 'edit'
                  ? t('در حال ذخیره…')
                  : t('در حال تمدید…')
                : mode === 'edit'
                  ? t('ذخیره تغییرات')
                  : t('تأیید تمدید')}
            </Button>
          </div>
        }
      >
        {user ? (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-medium" dir="ltr">
                  {user.marzbanUsername}
                </p>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(user.status)}`}
                >
                  {t(statusLabel(user.status))}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                <p>
                  {t('مصرف:')} {formatBytes(user.usedTrafficBytes)} /{' '}
                  {formatBytes(user.dataLimitBytes)}
                </p>
                <p>
                  {t('انقضا:')}{' '}
                  {user.expireAt ? formatDate(user.expireAt) : t('نامحدود')}
                </p>
              </div>
              {user.subscriptionUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 h-10 w-full sm:h-8"
                  onClick={() => setShareOpen(true)}
                >
                  {t('QR / اشتراک‌گذاری')}
                </Button>
              ) : null}
            </div>

            <div
              role="tablist"
              aria-label={t('نوع عملیات')}
              className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1"
            >
              {(
                [
                  { id: 'renew', label: t('تمدید') },
                  { id: 'edit', label: t('ویرایش') },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab.id}
                  className={cn(
                    'h-11 rounded-lg text-sm font-medium transition-colors sm:h-10',
                    mode === tab.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => {
                    setMode(tab.id)
                    editForm.clearErrors('root')
                    renewForm.clearErrors('root')
                  }}
                >
                  {t(tab.label)}
                </button>
              ))}
            </div>

            {mode === 'edit' ? (
              <form
                id={EDIT_FORM_ID}
                onSubmit={editForm.handleSubmit(onEditSubmit)}
                noValidate
              >
                <FieldGroup>
                  <DataLimitField
                    control={editForm.control}
                    name="dataLimitGb"
                    id={`${EDIT_FORM_ID}-data-limit`}
                  />
                  <Controller
                    control={editForm.control}
                    name="note"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`${EDIT_FORM_ID}-note`}>
                          {t('یادداشت')}
                        </FieldLabel>
                        <Textarea
                          {...field}
                          id={`${EDIT_FORM_ID}-note`}
                          rows={2}
                          value={field.value ?? ''}
                          aria-invalid={fieldState.invalid}
                        />
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />
                  <Controller
                    control={editForm.control}
                    name="password"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`${EDIT_FORM_ID}-password`}>
                          {t('رمز عبور جدید')}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={`${EDIT_FORM_ID}-password`}
                          type="text"
                          dir="ltr"
                          className="h-11 sm:h-8"
                          autoComplete="off"
                          placeholder={t('مثلاً 1234 — خالی = بدون تغییر')}
                          value={field.value ?? ''}
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldDescription>
                          {t(
                            'بدون محدودیت طول یا پیچیدگی. فقط برای پروتکل‌های Trojan / Shadowsocks اعمال می‌شود.',
                          )}
                        </FieldDescription>
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />
                  {editForm.formState.errors.root ? (
                    <FieldError>
                      {editForm.formState.errors.root.message}
                    </FieldError>
                  ) : null}
                </FieldGroup>
              </form>
            ) : (
              <form
                id={RENEW_FORM_ID}
                onSubmit={renewForm.handleSubmit(onRenewSubmit)}
                noValidate
              >
                <FieldGroup>
                  <DurationMonthsField
                    control={renewForm.control}
                    name="durationMonths"
                    options={durationOptions}
                    label={t('مدت تمدید')}
                    description={
                      allowUnlimitedExpire
                        ? t(
                            'از تاریخ فعلی تمدید می‌شود؛ نامحدود انقضا را حذف می‌کند',
                          )
                        : t('اگر هنوز اعتبار دارد، از تاریخ فعلی تمدید می‌شود')
                    }
                  />

                  <DataLimitField
                    control={renewForm.control}
                    name="dataLimitGb"
                    id={`${RENEW_FORM_ID}-data-limit`}
                  />

                  <Controller
                    control={renewForm.control}
                    name="resetUsage"
                    render={({ field, fieldState }) => (
                      <Field
                        orientation="horizontal"
                        data-invalid={fieldState.invalid}
                        className="rounded-xl border p-3"
                      >
                        <FieldContent>
                          <FieldLabel htmlFor={`${RENEW_FORM_ID}-reset`}>
                            {t('ریست حجم مصرفی')}
                          </FieldLabel>
                          <FieldDescription>
                            {t('مصرف فعلی صفر شود')}
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          id={`${RENEW_FORM_ID}-reset`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          aria-invalid={fieldState.invalid}
                        />
                      </Field>
                    )}
                  />

                  <Controller
                    control={renewForm.control}
                    name="reactivate"
                    render={({ field, fieldState }) => (
                      <Field
                        orientation="horizontal"
                        data-invalid={fieldState.invalid}
                        className="rounded-xl border p-3"
                      >
                        <FieldContent>
                          <FieldLabel htmlFor={`${RENEW_FORM_ID}-reactivate`}>
                            {t('فعال‌سازی مجدد')}
                          </FieldLabel>
                          <FieldDescription>
                            {t('در صورت غیرفعال/منقضی بودن')}
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          id={`${RENEW_FORM_ID}-reactivate`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          aria-invalid={fieldState.invalid}
                        />
                      </Field>
                    )}
                  />

                  <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm">
                    <p className="font-medium">{t('خلاصه تمدید')}</p>
                    <p className="mt-1 text-muted-foreground">
                      {typeof renewGb === 'number' && !Number.isNaN(renewGb)
                        ? t('{0} گیگابایت', { '0': renewGb })
                        : '—'}{' '}
                      · {t(durationLabel(renewDuration))} {t('· انقضای جدید')}{' '}
                      {renewPreview
                        ? formatDate(renewPreview.toISOString())
                        : t('نامحدود')}
                    </p>
                    {renewPrice != null ? (
                      <p className="mt-1 text-muted-foreground">
                        {t('برآورد قیمت:')}{' '}
                        <span className="font-medium text-foreground">
                          {formatToman(renewPrice)}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  {renewForm.formState.errors.root ? (
                    <FieldError>
                      {renewForm.formState.errors.root.message}
                    </FieldError>
                  ) : null}
                </FieldGroup>
              </form>
            )}
          </div>
        ) : null}
      </ResponsiveFormShell>

      {user?.subscriptionUrl != null ? (
        <SubscriptionShareDialog
          target={{
            username: user.marzbanUsername,
            subscriptionUrl: user.subscriptionUrl,
          }}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </>
  )
}
