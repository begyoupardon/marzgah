import { useI18n } from '#/components/locale-provider'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { UseFormSetError } from 'react-hook-form'
import * as z from 'zod'

import { Button } from '#/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { statusColor, statusLabel } from '#/lib/format'
import { usernameSuffixSchema } from '#/lib/reseller-naming'

export type ResellerFormMode = 'create' | 'edit'

export type ResellerFormValues = {
  name: string
  email: string
  password: string
  usernameSuffix: string
  pricePerGbToman: number
  allowUnlimitedExpire: boolean
  status: 'active' | 'disabled'
  notes: string
  billingType: 'postpaid' | 'prepaid'
  initialBalanceToman?: number
  creditLimitToman?: number | null
  targetBalanceToman?: number
}

export type ResellerFormTarget = {
  id: string
  name: string
  email: string
  status: string | null
  usernameSuffix: string | null
  pricePerGbToman: number | null
  allowUnlimitedExpire?: boolean | null
  notes: string | null
  balanceToman?: number | null
  creditLimitToman?: number | null
}

const FORM_ID = 'reseller-form'

function createResellerFormSchema(mode: ResellerFormMode) {
  return z.object({
    name: z.string().trim().min(1, 'نام الزامی است'),
    email: mode === 'create' ? z.email('ایمیل معتبر وارد کنید') : z.string(),
    password:
      mode === 'create' ? z.string().min(1, 'رمز عبور الزامی است') : z.string(),
    usernameSuffix: usernameSuffixSchema,
    pricePerGbToman: z
      .number({ error: 'قیمت هر گیگ الزامی است' })
      .int('قیمت باید عدد صحیح باشد')
      .positive('قیمت هر گیگ باید بزرگ‌تر از صفر باشد'),
    allowUnlimitedExpire: z.boolean(),
    status: z.enum(['active', 'disabled']),
    notes: z.string(),
    billingType: z.enum(['postpaid', 'prepaid']),
    initialBalanceToman: z
      .number()
      .int('موجودی باید عدد صحیح باشد')
      .min(0, 'موجودی نمی‌تواند منفی باشد')
      .optional()
      .default(0),
    creditLimitToman: z
      .number()
      .int('سقف اعتبار باید عدد صحیح باشد')
      .min(0, 'سقف اعتبار نمی‌تواند منفی باشد')
      .nullable()
      .optional(),
    targetBalanceToman: z
      .number()
      .int('موجودی باید عدد صحیح باشد')
      .min(0, 'موجودی نمی‌تواند منفی باشد')
      .optional(),
  })
}

const createDefaults: ResellerFormValues = {
  name: '',
  email: '',
  password: '',
  usernameSuffix: '',
  pricePerGbToman: 10000,
  allowUnlimitedExpire: false,
  status: 'active',
  notes: '',
  billingType: 'postpaid',
  initialBalanceToman: 0,
  creditLimitToman: null,
  targetBalanceToman: undefined,
}

function toFormValues(
  mode: ResellerFormMode,
  reseller: ResellerFormTarget | null,
): ResellerFormValues {
  if (mode === 'edit' && reseller) {
    return {
      name: reseller.name,
      email: reseller.email,
      password: '',
      usernameSuffix: reseller.usernameSuffix ?? '',
      pricePerGbToman: reseller.pricePerGbToman ?? 10000,
      allowUnlimitedExpire: Boolean(reseller.allowUnlimitedExpire),
      status: reseller.status === 'disabled' ? 'disabled' : 'active',
      notes: reseller.notes ?? '',
      billingType: reseller.creditLimitToman != null ? 'prepaid' : 'postpaid',
      creditLimitToman: reseller.creditLimitToman ?? null,
      targetBalanceToman:
        reseller.balanceToman != null
          ? Number(reseller.balanceToman)
          : undefined,
    }
  }
  return createDefaults
}

export type ResellerFormSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: ResellerFormMode
  reseller?: ResellerFormTarget | null
  pending?: boolean
  onSubmit: (
    values: ResellerFormValues,
    helpers: { setError: UseFormSetError<ResellerFormValues> },
  ) => void | Promise<void>
}

export function ResellerFormSheet({
  open,
  onOpenChange,
  mode,
  reseller = null,
  pending = false,
  onSubmit,
}: ResellerFormSheetProps) {
  const { t, formatToman, direction } = useI18n()

  const schema = useMemo(() => createResellerFormSchema(mode), [mode])
  const form = useForm<ResellerFormValues>({
    resolver: zodResolver(schema),
    defaultValues: createDefaults,
    mode: 'onTouched',
  })

  const { control, handleSubmit, reset, setError, formState } = form

  const suffixPreview = useWatch({ control, name: 'usernameSuffix' })
  const status = useWatch({ control, name: 'status' })
  const billingType = useWatch({ control, name: 'billingType' })

  useEffect(() => {
    if (!open) return
    reset(toFormValues(mode, reseller))
  }, [open, mode, reseller, reset])

  const isCreate = mode === 'create'
  const title = isCreate ? t('ایجاد نماینده') : t('ویرایش نماینده')
  const description = isCreate
    ? t('اطلاعات نماینده جدید را وارد کنید')
    : reseller
      ? t('به‌روزرسانی تنظیمات {0} ({1})', {
          '0': reseller.name,
          '1': reseller.email,
        })
      : t('اطلاعات نماینده را به‌روزرسانی کنید')
  const submitLabel = pending
    ? isCreate
      ? t('در حال ایجاد…')
      : t('در حال ذخیره…')
    : isCreate
      ? t('ایجاد')
      : t('ذخیره تغییرات')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'right' : 'left'}
        className="w-full gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b text-start">
          <div className="flex flex-wrap items-center gap-2 pe-8">
            <SheetTitle>{t(title)}</SheetTitle>
            {!isCreate ? (
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(status)}`}
              >
                {t(statusLabel(status))}
              </span>
            ) : null}
          </div>
          <SheetDescription>{t(description)}</SheetDescription>
        </SheetHeader>

        <form
          id={FORM_ID}
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit((values: ResellerFormValues) => {
            const finalValues: ResellerFormValues = {
              ...values,
              creditLimitToman:
                values.billingType === 'postpaid'
                  ? null
                  : (values.creditLimitToman ?? 0),
              initialBalanceToman:
                values.billingType === 'postpaid'
                  ? 0
                  : (values.initialBalanceToman ?? 0),
            }
            return onSubmit(finalValues, { setError })
          })}
          noValidate
        >
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <FieldGroup>
              <FieldSet>
                <FieldLegend variant="label">{t('اطلاعات پایه')}</FieldLegend>
                <FieldGroup>
                  <Controller
                    name="name"
                    control={control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`${FORM_ID}-name`}>
                          {t('نام')}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={`${FORM_ID}-name`}
                          aria-invalid={fieldState.invalid}
                          autoComplete="off"
                        />
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />

                  {isCreate ? (
                    <Controller
                      name="email"
                      control={control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={`${FORM_ID}-email`}>
                            {t('ایمیل')}
                          </FieldLabel>
                          <Input
                            {...field}
                            id={`${FORM_ID}-email`}
                            type="email"
                            dir="ltr"
                            aria-invalid={fieldState.invalid}
                            autoComplete="off"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                  ) : (
                    <Field>
                      <FieldLabel htmlFor={`${FORM_ID}-email`}>
                        {t('ایمیل')}
                      </FieldLabel>
                      <Input
                        id={`${FORM_ID}-email`}
                        value={reseller?.email ?? ''}
                        disabled
                        dir="ltr"
                      />
                      <FieldDescription>
                        {t('ایمیل ورود قابل تغییر نیست')}
                      </FieldDescription>
                    </Field>
                  )}

                  <Controller
                    name="notes"
                    control={control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`${FORM_ID}-notes`}>
                          {t('توضیحات')} {isCreate ? t('(اختیاری)') : ''}
                        </FieldLabel>
                        <Textarea
                          {...field}
                          id={`${FORM_ID}-notes`}
                          rows={2}
                          aria-invalid={fieldState.invalid}
                        />
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">
                  {t('نام‌گذاری و قیمت')}
                </FieldLegend>
                <FieldGroup>
                  <Controller
                    name="usernameSuffix"
                    control={control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`${FORM_ID}-suffix`}>
                          {t('پسوند نام کاربری')}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={`${FORM_ID}-suffix`}
                          dir="ltr"
                          className="font-mono"
                          placeholder="example"
                          aria-invalid={fieldState.invalid}
                          autoComplete="off"
                        />
                        <FieldDescription dir="ltr">
                          {(suffixPreview || 'example').toLowerCase()}_name1
                        </FieldDescription>
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />
                  <Controller
                    name="pricePerGbToman"
                    control={control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`${FORM_ID}-price`}>
                          {t('قیمت هر گیگ (تومان)')}
                        </FieldLabel>
                        <Input
                          id={`${FORM_ID}-price`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          dir="ltr"
                          aria-invalid={fieldState.invalid}
                          value={
                            Number.isFinite(field.value) ? field.value : ''
                          }
                          onChange={(event) => {
                            const next = event.target.value
                            field.onChange(
                              next === '' ? Number.NaN : Number(next),
                            )
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">
                  {t('کیف پول و مدل مالی')}
                </FieldLegend>
                <FieldGroup>
                  <div className="space-y-1">
                    <FieldLabel>{t('مدل تسویه‌حساب نماینده')}</FieldLabel>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className={`flex flex-col gap-1 rounded-xl border p-3 text-start transition cursor-pointer ${
                          billingType === 'postpaid'
                            ? 'border-primary bg-primary/5 text-foreground ring-1 ring-primary/20'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                        }`}
                        onClick={() => {
                          form.setValue('billingType', 'postpaid')
                          form.setValue('creditLimitToman', null)
                        }}
                      >
                        <span className="font-semibold text-foreground">
                          {t('پس‌پرداخت (ثبت بدهی)')}
                        </span>
                        <span className="text-xs text-muted-foreground leading-relaxed">
                          {t(
                            'ساخت کانفیگ بدون موجودی اولیه؛ اعلام پرداخت توسط نماینده و تسویه توسط ادمین در صفحه تسویه',
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`flex flex-col gap-1 rounded-xl border p-3 text-start transition cursor-pointer ${
                          billingType === 'prepaid'
                            ? 'border-primary bg-primary/5 text-foreground ring-1 ring-primary/20'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
                        }`}
                        onClick={() => {
                          form.setValue('billingType', 'prepaid')
                          if (form.getValues('creditLimitToman') == null) {
                            form.setValue('creditLimitToman', 0)
                          }
                        }}
                      >
                        <span className="font-semibold text-foreground">
                          {t('پیش‌پرداخت (موجودی‌محور)')}
                        </span>
                        <span className="text-xs text-muted-foreground leading-relaxed">
                          {t(
                            'ساخت کانفیگ فقط با داشتن موجودی در کیف پول؛ مدیریت و شارژ توسط ادمین',
                          )}
                        </span>
                      </button>
                    </div>
                  </div>

                  {billingType === 'prepaid' ? (
                    <>
                      {isCreate ? (
                        <Controller
                          name="initialBalanceToman"
                          control={control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                              <FieldLabel
                                htmlFor={`${FORM_ID}-initial-balance`}
                              >
                                {t('موجودی اولیه کیف پول (تومان)')}
                              </FieldLabel>
                              <Input
                                id={`${FORM_ID}-initial-balance`}
                                type="number"
                                min={0}
                                step={1000}
                                inputMode="numeric"
                                dir="ltr"
                                placeholder="0"
                                aria-invalid={fieldState.invalid}
                                value={
                                  Number.isFinite(field.value)
                                    ? field.value
                                    : ''
                                }
                                onChange={(event) => {
                                  const next = event.target.value
                                  field.onChange(next === '' ? 0 : Number(next))
                                }}
                                onBlur={field.onBlur}
                                name={field.name}
                                ref={field.ref}
                              />
                              <FieldDescription>
                                {t(
                                  'در بدو ایجاد حساب به عنوان شارژ اولیه به کیف پول اضافه می‌شود',
                                )}
                              </FieldDescription>
                              {fieldState.invalid ? (
                                <FieldError errors={[fieldState.error]} />
                              ) : null}
                            </Field>
                          )}
                        />
                      ) : (
                        <div className="space-y-4">
                          {reseller?.balanceToman != null ? (
                            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-sm">
                              <span className="text-muted-foreground">
                                {t('موجودی فعلی:')}
                              </span>
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                {formatToman(reseller.balanceToman)}
                              </span>
                            </div>
                          ) : null}
                          <Controller
                            name="targetBalanceToman"
                            control={control}
                            render={({ field, fieldState }) => (
                              <Field data-invalid={fieldState.invalid}>
                                <FieldLabel
                                  htmlFor={`${FORM_ID}-target-balance`}
                                >
                                  {t('تنظیم موجودی جدید (تومان)')}
                                </FieldLabel>
                                <Input
                                  id={`${FORM_ID}-target-balance`}
                                  type="number"
                                  min={0}
                                  step={1000}
                                  inputMode="numeric"
                                  dir="ltr"
                                  placeholder={
                                    reseller?.balanceToman != null
                                      ? String(reseller.balanceToman)
                                      : '0'
                                  }
                                  aria-invalid={fieldState.invalid}
                                  value={
                                    field.value != null &&
                                    Number.isFinite(field.value)
                                      ? field.value
                                      : ''
                                  }
                                  onChange={(event) => {
                                    const next = event.target.value
                                    field.onChange(
                                      next === '' ? undefined : Number(next),
                                    )
                                  }}
                                  onBlur={field.onBlur}
                                  name={field.name}
                                  ref={field.ref}
                                />
                                <FieldDescription>
                                  {t(
                                    'موجودی به این عدد تغییر می‌یابد (اختلاف در گردش حساب ثبت می‌شود)',
                                  )}
                                </FieldDescription>
                                {fieldState.invalid ? (
                                  <FieldError errors={[fieldState.error]} />
                                ) : null}
                              </Field>
                            )}
                          />
                        </div>
                      )}

                      <Controller
                        name="creditLimitToman"
                        control={control}
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor={`${FORM_ID}-credit-limit`}>
                              {t('سقف اعتبار کمکی / بدهی مجاز (تومان)')}
                            </FieldLabel>
                            <Input
                              id={`${FORM_ID}-credit-limit`}
                              type="number"
                              min={0}
                              step={10000}
                              inputMode="numeric"
                              dir="ltr"
                              placeholder={t('0 = فقط بر اساس موجودی کیف پول')}
                              aria-invalid={fieldState.invalid}
                              value={field.value == null ? '' : field.value}
                              onChange={(event) => {
                                const next = event.target.value
                                field.onChange(next === '' ? 0 : Number(next))
                              }}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                            <FieldDescription>
                              {t(
                                '۰ = نماینده فقط به میزان موجودی کیف پول می‌تواند کاربر بسازد. وارد کردن عدد اجازه می‌دهد تا این مبلغ بدهی موقت داشته باشد.',
                              )}
                            </FieldDescription>
                            {fieldState.invalid ? (
                              <FieldError errors={[fieldState.error]} />
                            ) : null}
                          </Field>
                        )}
                      />
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                      {t(
                        'در حالت پس‌پرداخت، نماینده نیازی به شارژ اولیه ندارد. هزینه هر کانفیگ به عنوان بدهی ثبت شده و نماینده در صفحه «تسویه و بدهی» می‌تواند پرداخت خود را اعلام کند تا توسط شما بررسی و تسویه گردد.',
                      )}
                    </div>
                  )}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">{t('دسترسی‌ها')}</FieldLegend>
                <FieldGroup>
                  {!isCreate ? (
                    <Controller
                      name="status"
                      control={control}
                      render={({ field, fieldState }) => (
                        <Field
                          orientation="horizontal"
                          data-invalid={fieldState.invalid}
                          className="rounded-xl border p-3"
                        >
                          <FieldContent>
                            <FieldLabel htmlFor={`${FORM_ID}-active`}>
                              {t('حساب فعال')}
                            </FieldLabel>
                            <FieldDescription>
                              {t(
                                'در حالت غیرفعال، نماینده نمی‌تواند کاربر بسازد',
                              )}
                            </FieldDescription>
                          </FieldContent>
                          <Switch
                            id={`${FORM_ID}-active`}
                            checked={field.value === 'active'}
                            onCheckedChange={(checked) =>
                              field.onChange(checked ? 'active' : 'disabled')
                            }
                            aria-invalid={fieldState.invalid}
                          />
                        </Field>
                      )}
                    />
                  ) : null}
                  <Controller
                    name="allowUnlimitedExpire"
                    control={control}
                    render={({ field, fieldState }) => (
                      <Field
                        orientation="horizontal"
                        data-invalid={fieldState.invalid}
                        className="rounded-xl border p-3"
                      >
                        <FieldContent>
                          <FieldLabel htmlFor={`${FORM_ID}-unlimited`}>
                            {t('حساب نامحدود')}
                          </FieldLabel>
                          <FieldDescription>
                            {t(
                              'اجازه ساخت و تمدید کاربران VPN بدون تاریخ انقضا',
                            )}
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          id={`${FORM_ID}-unlimited`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          aria-invalid={fieldState.invalid}
                        />
                      </Field>
                    )}
                  />
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">{t('امنیت')}</FieldLegend>
                <FieldGroup>
                  <Controller
                    name="password"
                    control={control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`${FORM_ID}-password`}>
                          {isCreate ? t('رمز عبور') : t('رمز عبور جدید')}
                        </FieldLabel>
                        <Input
                          {...field}
                          id={`${FORM_ID}-password`}
                          type="text"
                          dir="ltr"
                          autoComplete="new-password"
                          placeholder={
                            isCreate ? t('مثلاً 1234') : t('خالی = بدون تغییر')
                          }
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldDescription>
                          {isCreate
                            ? t('بدون محدودیت طول یا پیچیدگی')
                            : t(
                                'فقط در صورت نیاز پر کنید؛ بدون محدودیت طول یا پیچیدگی',
                              )}
                        </FieldDescription>
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />
                </FieldGroup>
              </FieldSet>

              {formState.errors.root ? (
                <FieldError>{formState.errors.root.message}</FieldError>
              ) : null}
            </FieldGroup>
          </div>
        </form>

        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          <SheetClose
            render={
              <Button type="button" variant="outline" className="h-11 sm:h-8" />
            }
          >
            {t('انصراف')}
          </SheetClose>
          <Button
            type="submit"
            form={FORM_ID}
            className="h-11 sm:h-8"
            disabled={pending || formState.isSubmitting}
          >
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
