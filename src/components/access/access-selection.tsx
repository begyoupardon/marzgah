import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useI18n } from '#/components/locale-provider'
import { Button } from '#/components/ui/button'
import { orpc } from '#/orpc/client'
import { HostPicker } from './host-picker'
import type { AccessSelection } from '#/lib/access-policy'
import type { InboundRef } from '#/lib/backends/types'

export function AccessSelectionField({
  value,
  onChange,
  resellerId,
  backend = 'marzban',
  disabled = false,
  allowDefault = true,
  fallbackInbounds,
  templateName,
}: {
  value?: AccessSelection
  onChange: (value: AccessSelection | undefined) => void
  resellerId?: string
  backend?: string
  locked?: InboundRef[]
  disabled?: boolean
  allowDefault?: boolean
  fallbackInbounds?: InboundRef[]
  templateName?: string | null
}) {
  const { t } = useI18n()
  const id = useId()
  const query = useQuery(
    orpc.access.catalog.queryOptions({ input: { backend, resellerId } }),
  )
  if (query.isPending)
    return <p role="status">{t('در حال دریافت اینباندها…')}</p>
  if (query.error || !query.data)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t('دریافت اینباندها انجام نشد')}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          {t('تلاش مجدد')}
        </Button>
      </div>
    )
  const data = query.data
  const mode = value?.mode ?? 'default'
  const selected =
    value?.mode === 'custom'
      ? value.inbounds
      : (data.templates.find(
          (item) =>
            item.id ===
            (value?.mode === 'template'
              ? value.templateId
              : data.defaultTemplateId),
        )?.inbounds ??
        fallbackInbounds ??
        (data.defaultSelection.mode === 'custom'
          ? data.defaultSelection.inbounds
          : []))
  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm" htmlFor={id}>
        <span>{t('روش انتخاب دسترسی')}</span>
        <select
          id={id}
          className="h-11 w-full rounded-lg border bg-background px-3"
          disabled={disabled}
          value={
            mode === 'template'
              ? `template:${value!.mode === 'template' ? value!.templateId : ''}`
              : mode
          }
          onChange={(e) => {
            const next = e.target.value
            onChange(
              next === 'default'
                ? undefined
                : next === 'custom'
                  ? { mode: 'custom', inbounds: selected }
                  : { mode: 'template', templateId: next.slice(9) },
            )
          }}
        >
          {allowDefault && (
            <option value="default">{t('پیش‌فرض نماینده')}</option>
          )}
          {value?.mode === 'template' &&
            !data.templates.some((item) => item.id === value.templateId) && (
              <option value={`template:${value.templateId}`}>
                {templateName ?? value.templateId} · {t('قالب مرتبط')}
              </option>
            )}
          {data.templates.map((item) => (
            <option value={`template:${item.id}`} key={item.id}>
              {item.name} · {t('قالب مرتبط')}
            </option>
          ))}
          <option value="custom">{t('انتخاب سفارشی')}</option>
        </select>
      </label>
      {!data.hostsAvailable && (
        <p className="text-xs text-muted-foreground">
          {t('جزئیات میزبان‌ها در دسترس نیست؛ انتخاب اینباند فعال است.')}
        </p>
      )}
      <HostPicker
        label={t('میزبان‌های اتصال')}
        catalog={data.inbounds}
        value={selected}
        required={data.required}
        disabled={disabled || mode !== 'custom'}
        onChange={(inbounds) => onChange({ mode: 'custom', inbounds })}
      />
      {mode === 'template' && (
        <p className="text-xs text-muted-foreground">
          {t('تغییرات قالب برای این کاربر نیز اعمال می‌شود.')}
        </p>
      )}
    </div>
  )
}
