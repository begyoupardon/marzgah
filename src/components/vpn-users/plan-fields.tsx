import { useI18n } from '#/components/locale-provider'
import { cn } from 'cn'
import { Controller } from 'react-hook-form'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  DATA_PRESETS_GB,
  durationLabel,
  isUnlimitedDuration,
  MIN_DATA_LIMIT_GB,
} from '#/lib/vpn-plans'
import type { DurationChoice } from '#/lib/vpn-plans'

export function DataLimitField<T extends FieldValues>({
  control,
  name,
  id,
}: {
  control: Control<T>
  name: FieldPath<T>
  id: string
}) {
  const { t } = useI18n()

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{t('حجم مصرف')}</FieldLabel>
          <FieldDescription>
            {t('الزامی — حداقل')} {MIN_DATA_LIMIT_GB} {t('گیگابایت')}
          </FieldDescription>
          <div
            role="radiogroup"
            aria-label={t('حجم پیشنهادی')}
            className="grid grid-cols-3 gap-1.5"
          >
            {DATA_PRESETS_GB.map((gb) => {
              const selected = Number(field.value) === gb
              return (
                <button
                  key={gb}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    'rounded-lg border px-1 py-2 text-center text-sm transition-colors',
                    selected
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background hover:bg-muted',
                  )}
                  onClick={() => field.onChange(gb)}
                >
                  {gb}
                  <span className="mt-0.5 block text-[10px] opacity-70">
                    {t('گیگ')}
                  </span>
                </button>
              )
            })}
          </div>
          <FieldLabel htmlFor={id} className="text-muted-foreground">
            {t('یا مقدار دلخواه (گیگابایت)')}
          </FieldLabel>
          <Input
            id={id}
            type="number"
            min={MIN_DATA_LIMIT_GB}
            step="1"
            inputMode="decimal"
            dir="ltr"
            aria-invalid={fieldState.invalid}
            value={
              typeof field.value === 'number' && Number.isFinite(field.value)
                ? field.value
                : ''
            }
            onChange={(event) => {
              const next = event.target.value
              field.onChange(next === '' ? Number.NaN : Number(next))
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
  )
}

export function DurationMonthsField<T extends FieldValues>({
  control,
  name,
  options,
  label,
  description,
}: {
  control: Control<T>
  name: FieldPath<T>
  options: DurationChoice[]
  label: string
  description: string
}) {
  const { t } = useI18n()

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel>{t(label)}</FieldLabel>
          <FieldDescription>{t(description)}</FieldDescription>
          <div
            role="radiogroup"
            aria-label={t(label)}
            className={cn(
              'grid gap-2',
              options.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3',
            )}
          >
            {options.map((months) => {
              const selected = field.value === months
              const unlimited = isUnlimitedDuration(months)
              return (
                <button
                  key={months}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    'min-h-12 rounded-lg border px-2 py-3 text-center transition-colors',
                    selected
                      ? unlimited
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background hover:bg-muted',
                  )}
                  onClick={() => field.onChange(months)}
                >
                  <span className="block text-sm font-medium">
                    {t(durationLabel(months))}
                  </span>
                </button>
              )
            })}
          </div>
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : null}
        </Field>
      )}
    />
  )
}
