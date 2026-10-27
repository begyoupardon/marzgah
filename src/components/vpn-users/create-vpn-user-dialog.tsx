import { useI18n } from '#/components/locale-provider'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { Button } from '#/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '#/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import {
  DataLimitField,
  DurationMonthsField,
} from '#/components/vpn-users/plan-fields'
import { ResponsiveFormShell } from '#/components/vpn-users/responsive-form-shell'
import { getErrorMessage, isConflictError } from '#/lib/errors'

import { buildVpnUsername } from '#/lib/reseller-naming'
import { toastError, toastSuccess } from '#/lib/toast'
import {
  createVpnUserDefaults,
  createVpnUserFormSchema,
  DURATION_MONTHS,
  durationLabel,
  expireAtFromDuration,
  gbToBytes,
  isUnlimitedDuration,
  UNLIMITED_DURATION,
} from '#/lib/vpn-plans'
import type { CreateVpnUserFormValues, DurationChoice } from '#/lib/vpn-plans'
import { orpc } from '#/orpc/client'

export type CreateVpnUserResellerOption = {
  id: string
  name: string
  email: string
  usernameSuffix: string
  pricePerGbToman: number
  allowUnlimitedExpire: boolean
}

export type CreateVpnUserOwnProfile = {
  usernameSuffix: string
  pricePerGbToman: number
  allowUnlimitedExpire: boolean
}

const FORM_ID = 'create-vpn-user-form'

export function CreateVpnUserDialog({
  open,
  onOpenChange,
  isAdmin,
  resellers,
  ownProfile,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isAdmin: boolean
  resellers: CreateVpnUserResellerOption[]
  ownProfile: CreateVpnUserOwnProfile | null
  onCreated: () => void | Promise<unknown>
}) {
  const { t, formatDate, formatToman } = useI18n()

  const schema = useMemo(() => createVpnUserFormSchema(isAdmin), [isAdmin])

  const form = useForm<CreateVpnUserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: createVpnUserDefaults,
    mode: 'onTouched',
  })

  const {
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setValue,
    formState: { isSubmitting },
  } = form

  const dataLimitGb = useWatch({ control, name: 'dataLimitGb' })
  const durationMonths = useWatch({ control, name: 'durationMonths' })
  const username = useWatch({ control, name: 'username' })
  const selectedResellerId = useWatch({ control, name: 'resellerId' })

  const activeProfile = useMemo(() => {
    if (isAdmin) {
      return resellers.find((r) => r.id === selectedResellerId) ?? null
    }
    return ownProfile
  }, [isAdmin, ownProfile, resellers, selectedResellerId])

  const fullUsernamePreview = useMemo(() => {
    if (!activeProfile?.usernameSuffix || !username.trim()) return null
    return buildVpnUsername(activeProfile.usernameSuffix, username)
  }, [activeProfile?.usernameSuffix, username])

  const estimatedPrice = useMemo(() => {
    if (
      !activeProfile ||
      typeof dataLimitGb !== 'number' ||
      Number.isNaN(dataLimitGb)
    ) {
      return null
    }
    return dataLimitGb * activeProfile.pricePerGbToman
  }, [activeProfile, dataLimitGb])

  const expirePreview = useMemo(
    () => expireAtFromDuration(durationMonths),
    [durationMonths],
  )

  const allowUnlimited = Boolean(activeProfile?.allowUnlimitedExpire)
  const durationOptions: DurationChoice[] = allowUnlimited
    ? [...DURATION_MONTHS, UNLIMITED_DURATION]
    : [...DURATION_MONTHS]

  useEffect(() => {
    if (!allowUnlimited && isUnlimitedDuration(durationMonths)) {
      setValue('durationMonths', 1)
    }
  }, [allowUnlimited, durationMonths, setValue])

  useEffect(() => {
    if (open) reset(createVpnUserDefaults)
  }, [open, reset])

  const createMutation = useMutation({
    ...orpc.vpnUsers.create.mutationOptions(),
    onSuccess: async (_data, vars) => {
      onOpenChange(false)
      reset(createVpnUserDefaults)
      await onCreated()
      toastSuccess(t('کاربر ایجاد شد'), vars.username)
    },
    onError: (err) => {
      const message = t(getErrorMessage(err, 'ایجاد کاربر انجام نشد'))
      const isDuplicate =
        isConflictError(err) ||
        /قبلاً ثبت|already|exist|duplicate|conflict/i.test(message)

      if (isDuplicate) {
        setError('username', {
          type: 'server',
          message: t('این نام کاربری قبلاً ثبت شده است؛ نام دیگری انتخاب کنید'),
        })
      } else {
        setError('root', { message })
      }

      toastError(
        isDuplicate ? t('نام کاربری تکراری است') : t('ایجاد کاربر انجام نشد'),
        isDuplicate ? t('یک نام کاربری دیگر وارد کنید') : err,
      )
    },
  })

  const onSubmit = handleSubmit((values) => {
    clearErrors('username')
    createMutation.mutate({
      username: values.username,
      note: values.note?.trim() || null,
      dataLimitBytes: gbToBytes(values.dataLimitGb),
      durationMonths: values.durationMonths,
      ...(isAdmin ? { resellerId: values.resellerId } : {}),
    })
  })

  const pending = createMutation.isPending || isSubmitting

  return (
    <ResponsiveFormShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('ایجاد کاربر VPN')}
      description={t('نام کاربری، حجم و مدت اشتراک را تنظیم کنید')}
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
            form={FORM_ID}
            className="h-11 sm:h-8"
            disabled={pending}
          >
            {pending ? t('در حال ایجاد…') : t('ایجاد')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate>
        <FieldGroup>
          {isAdmin ? (
            <Controller
              control={control}
              name="resellerId"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`${FORM_ID}-reseller`}>
                    {t('نماینده مالک')}
                  </FieldLabel>
                  <Select
                    items={resellers.map((r) => ({
                      value: r.id,
                      label: `${r.name} (${r.email})`,
                    }))}
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? '')}
                  >
                    <SelectTrigger
                      id={`${FORM_ID}-reseller`}
                      className="h-11 sm:h-8"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue placeholder={t('انتخاب نماینده')} />
                    </SelectTrigger>
                    <SelectContent>
                      {resellers.map((r) => (
                        <SelectItem
                          key={r.id}
                          value={r.id}
                          description={r.email}
                        >
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
          ) : null}

          <Controller
            control={control}
            name="username"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${FORM_ID}-username`}>
                  {t('نام کاربری')}
                </FieldLabel>
                <InputGroup dir="ltr" className="h-11 font-mono sm:h-8">
                  {activeProfile?.usernameSuffix ? (
                    <InputGroupAddon align="inline-start">
                      <InputGroupText className="font-mono">
                        {activeProfile.usernameSuffix}_
                      </InputGroupText>
                    </InputGroupAddon>
                  ) : null}
                  <InputGroupInput
                    {...field}
                    id={`${FORM_ID}-username`}
                    autoComplete="off"
                    dir="ltr"
                    placeholder="name1"
                    aria-invalid={fieldState.invalid}
                    onChange={(event) => {
                      field.onChange(event)
                      if (fieldState.error?.type === 'server') {
                        clearErrors('username')
                      }
                    }}
                  />
                </InputGroup>
                {fullUsernamePreview ? (
                  <FieldDescription dir="ltr">
                    {t('نام نهایی:')}{' '}
                    <span className="font-mono">{fullUsernamePreview}</span>
                  </FieldDescription>
                ) : isAdmin && !selectedResellerId ? (
                  <FieldDescription>
                    {t('ابتدا نماینده را انتخاب کنید تا پسوند اعمال شود')}
                  </FieldDescription>
                ) : null}
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : null}
              </Field>
            )}
          />

          <DataLimitField
            control={control}
            name="dataLimitGb"
            id={`${FORM_ID}-data-limit`}
          />

          <DurationMonthsField
            control={control}
            name="durationMonths"
            options={durationOptions}
            label={t('مدت اشتراک')}
            description={
              allowUnlimited
                ? t('بازه زمانی یا حساب نامحدود را انتخاب کنید')
                : t('یکی از بازه‌های زیر را انتخاب کنید')
            }
          />

          <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm">
            <p className="font-medium">{t('خلاصه پلن')}</p>
            <p className="mt-1 text-muted-foreground">
              {typeof dataLimitGb === 'number' && !Number.isNaN(dataLimitGb)
                ? t('{0} گیگابایت', { '0': dataLimitGb })
                : '—'}{' '}
              · {t(durationLabel(durationMonths))} {t('· انقضا')}{' '}
              {expirePreview
                ? formatDate(expirePreview.toISOString())
                : t('نامحدود')}
            </p>
            {fullUsernamePreview ? (
              <p className="mt-1 font-mono text-muted-foreground" dir="ltr">
                {fullUsernamePreview}
              </p>
            ) : null}
            {estimatedPrice != null ? (
              <p className="mt-1 text-muted-foreground">
                {t('برآورد قیمت:')}{' '}
                <span className="font-medium text-foreground">
                  {formatToman(estimatedPrice)}
                </span>
                {activeProfile ? (
                  <span className="text-xs">
                    {' '}
                    ({formatToman(activeProfile.pricePerGbToman)} {t('× گیگ)')}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <Controller
            control={control}
            name="note"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${FORM_ID}-note`}>
                  {t('یادداشت (اختیاری)')}
                </FieldLabel>
                <Textarea
                  {...field}
                  id={`${FORM_ID}-note`}
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

          {form.formState.errors.root ? (
            <FieldError>{form.formState.errors.root.message}</FieldError>
          ) : null}
        </FieldGroup>
      </form>
    </ResponsiveFormShell>
  )
}
