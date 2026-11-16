import { useId, useState } from 'react'
import { useI18n } from '#/components/locale-provider'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import type { AccessCatalog, InboundRef } from '#/lib/backends/types'
import { inboundKey, normalizeInbounds } from '#/lib/access-policy'

export function InboundPicker({
  catalog,
  value,
  onChange,
  required = [],
  locked = [],
  disabled = false,
  label,
}: {
  catalog: AccessCatalog['inbounds']
  value: InboundRef[]
  onChange: (value: InboundRef[]) => void
  required?: InboundRef[]
  locked?: InboundRef[]
  disabled?: boolean
  label: string
}) {
  const { t } = useI18n()
  const id = useId()
  const [search, setSearch] = useState('')
  const keys = new Set(value.map(inboundKey))
  const fixed = new Set([...required, ...locked].map(inboundKey))
  const all = [
    ...catalog,
    ...normalizeInbounds([...value, ...required, ...locked])
      .filter((i) => !catalog.some((c) => inboundKey(c) === inboundKey(i)))
      .map((i) => ({ ...i, hosts: [] })),
  ]
  const visible = all.filter((i) =>
    `${i.protocol} ${i.tag} ${i.hosts.map((h) => `${h.remark} ${h.address}`).join(' ')}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  return (
    <fieldset
      className="min-w-0 space-y-3 rounded-xl border p-3"
      disabled={disabled}
      aria-describedby={`${id}-help`}
    >
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {t('انتخاب اینباند، همه میزبان‌های آن را شامل می‌شود.')}
      </p>
      <label className="block space-y-1 text-sm" htmlFor={`${id}-search`}>
        <span>{t('جستجوی اینباند یا میزبان')}</span>
        <Input
          id={`${id}-search`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span role="status">
          {t('{0} اینباند انتخاب شده', {
            0: normalizeInbounds([...value, ...required, ...locked]).length,
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange(
              normalizeInbounds([
                ...value,
                ...visible.filter((i) => !fixed.has(inboundKey(i))),
              ]),
            )
          }
        >
          {t('انتخاب موارد نمایان')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange(
              value.filter(
                (i) =>
                  fixed.has(inboundKey(i)) ||
                  !visible.some((v) => inboundKey(i) === inboundKey(v)),
              ),
            )
          }
        >
          {t('حذف انتخاب موارد نمایان')}
        </Button>
      </div>
      {!visible.length && (
        <p className="text-sm text-muted-foreground">
          {t('اینباندی پیدا نشد')}
        </p>
      )}
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {[...new Set(visible.map((i) => i.protocol))].map((protocol) => (
          <fieldset key={protocol} className="space-y-2">
            <legend className="font-mono text-xs font-medium" dir="ltr">
              {protocol}
            </legend>
            {visible
              .filter((i) => i.protocol === protocol)
              .map((i) => {
                const key = inboundKey(i)
                const unavailable = !catalog.some((c) => inboundKey(c) === key)
                return (
                  <label
                    key={key}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-ring"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-primary"
                      checked={keys.has(key) || fixed.has(key)}
                      disabled={fixed.has(key)}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? normalizeInbounds([...value, i])
                            : value.filter((v) => inboundKey(v) !== key),
                        )
                      }
                    />
                    <span className="min-w-0 break-words">
                      <span className="font-medium" dir="auto">
                        {i.tag}
                      </span>
                      {required.some((r) => inboundKey(r) === key) && (
                        <span className="ms-2 text-xs">
                          {t('الزامی برای همه')}
                        </span>
                      )}
                      {locked.some((r) => inboundKey(r) === key) && (
                        <span className="ms-2 text-xs">
                          {t('تحت کنترل مدیر')}
                        </span>
                      )}
                      {unavailable && (
                        <span className="ms-2 text-xs text-destructive">
                          {t('در دسترس نیست')}
                        </span>
                      )}
                      {i.hosts.map((h, index) => (
                        <span
                          key={index}
                          className="mt-1 block text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {h.remark} {h.address}
                        </span>
                      ))}
                    </span>
                  </label>
                )
              })}
          </fieldset>
        ))}
      </div>
    </fieldset>
  )
}
