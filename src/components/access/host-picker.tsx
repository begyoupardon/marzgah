import { useId, useRef, useEffect, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { useI18n } from '#/components/locale-provider'
import type { AccessCatalog, InboundRef } from '#/lib/backends/types'
import { inboundKey, normalizeInbounds } from '#/lib/access-policy'

export function SelectionCheckbox({
  checked,
  mixed = false,
  ...props
}: { checked: boolean; mixed?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
>) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-checked={mixed ? 'mixed' : checked}
      className="size-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-not-allowed"
    />
  )
}
export function selectedHostCount(
  catalog: AccessCatalog['inbounds'],
  value: InboundRef[],
) {
  return catalog.reduce((count, inbound) => {
    const item = value.find((i) => inboundKey(i) === inboundKey(inbound))
    return (
      count +
      inbound.hosts.filter(
        (h) =>
          !h.disabled &&
          h.id &&
          item &&
          (!item.hostIds || item.hostIds.includes(h.id)),
      ).length
    )
  }, 0)
}
export function HostPicker({
  catalog,
  value,
  onChange,
  required = [],
  disabled = false,
  label,
}: {
  catalog: AccessCatalog['inbounds']
  value: InboundRef[]
  onChange: (value: InboundRef[]) => void
  required?: InboundRef[]
  disabled?: boolean
  label: string
}) {
  const { t } = useI18n()
  const id = useId()
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState('all')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const all = catalog.flatMap((inbound) =>
    inbound.hosts.map((host) => ({ inbound, host })),
  )
  const isRequired = (inbound: InboundRef, hostId?: string) =>
    required.some(
      (i) =>
        inboundKey(i) === inboundKey(inbound) &&
        (!i.hostIds || (hostId && i.hostIds.includes(hostId))),
    )
  const isSelected = (inbound: InboundRef, hostId?: string) =>
    value.some(
      (i) =>
        inboundKey(i) === inboundKey(inbound) &&
        (!i.hostIds || (hostId && i.hostIds.includes(hostId))),
    ) || isRequired(inbound, hostId)
  const visible = all.filter(
    ({ inbound, host }) =>
      (protocol === 'all' || protocol === inbound.protocol) &&
      (!selectedOnly || isSelected(inbound, host.id)) &&
      `${host.remark} ${host.address} ${host.port ?? inbound.port ?? ''} ${inbound.tag}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const selectable = visible.filter(
    ({ inbound, host }) =>
      host.id && !host.disabled && !isRequired(inbound, host.id),
  )
  const checked = selectable.filter(({ inbound, host }) =>
    isSelected(inbound, host.id),
  ).length
  function toggle(rows: typeof all, select: boolean) {
    const next = new Map(
      value.map((v) => [
        inboundKey(v),
        {
          ...v,
          hostIds: v.hostIds
            ? [...v.hostIds]
            : (catalog
                .find((i) => inboundKey(i) === inboundKey(v))
                ?.hosts.filter((h) => h.id && !h.disabled)
                .map((h) => h.id!) ?? []),
        },
      ]),
    )
    for (const { inbound, host } of rows) {
      if (!host.id || host.disabled || isRequired(inbound, host.id)) continue
      const key = inboundKey(inbound)
      const current = next.get(key) ?? {
        protocol: inbound.protocol,
        tag: inbound.tag,
        hostIds: [],
      }
      current.hostIds = select
        ? [...new Set([...current.hostIds, host.id])]
        : current.hostIds.filter((h) => h !== host.id)
      if (current.hostIds.length) next.set(key, current)
      else next.delete(key)
    }
    onChange(normalizeInbounds([...next.values()]))
  }
  const unavailable = value.reduce(
    (count, i) =>
      count +
      (i.hostIds?.filter(
        (hostId) =>
          !all.some(
            (row) =>
              inboundKey(row.inbound) === inboundKey(i) &&
              row.host.id === hostId &&
              !row.host.disabled,
          ),
      ).length ??
        (catalog.some((row) => inboundKey(row) === inboundKey(i)) ? 0 : 1)),
    0,
  )
  return (
    <section
      aria-label={label}
      className="min-w-0 overflow-hidden rounded-2xl border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h3 className="font-semibold">{label}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              'هر میزبان را جداگانه انتخاب کنید؛ فقط کانفیگ‌های انتخاب‌شده در اشتراک نمایش داده می‌شوند.',
            )}
          </p>
        </div>
        <span
          className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
          role="status"
        >
          {t('{0} میزبان انتخاب شده', {
            0: selectedHostCount(
              catalog,
              normalizeInbounds([...value, ...required]),
            ),
          })}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b bg-muted/20 p-4">
        <label
          htmlFor={`${id}-search`}
          className="min-w-40 flex-1 space-y-1 text-xs font-medium"
        >
          <span>{t('جستجوی میزبان')}</span>
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="absolute start-3 top-3 size-4 text-muted-foreground"
            />
            <Input
              id={`${id}-search`}
              className="h-10 ps-9"
              placeholder={t('نام، آدرس یا اینباند…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </label>
        <label
          htmlFor={`${id}-protocol`}
          className="space-y-1 text-xs font-medium"
        >
          <span>{t('پروتکل')}</span>
          <select
            id={`${id}-protocol`}
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            className="h-10 w-full rounded-lg border bg-background px-3"
          >
            <option value="all">{t('همه پروتکل‌ها')}</option>
            {[...new Set(catalog.map((i) => i.protocol))].map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant={selectedOnly ? 'secondary' : 'outline'}
          aria-pressed={selectedOnly}
          className="h-10"
          onClick={() => setSelectedOnly(!selectedOnly)}
        >
          {t('فقط انتخاب‌شده‌ها')}
        </Button>
      </div>
      {unavailable > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b bg-destructive/5 p-3 text-sm text-destructive"
        >
          <span>
            {t('{0} میزبان ذخیره‌شده در دسترس نیست', { 0: unavailable })}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onChange(
                value
                  .filter((v) =>
                    catalog.some((i) => inboundKey(i) === inboundKey(v)),
                  )
                  .map((v) => ({
                    ...v,
                    hostIds: v.hostIds?.filter((id) =>
                      all.some(
                        (row) =>
                          inboundKey(row.inbound) === inboundKey(v) &&
                          row.host.id === id &&
                          !row.host.disabled,
                      ),
                    ),
                  }))
                  .filter((v) => !v.hostIds || v.hostIds.length > 0),
              )
            }
          >
            {t('حذف موارد ناموجود')}
          </Button>
        </div>
      )}
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-start text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="sticky top-0 z-10 border-b bg-muted">
            <tr>
              <th className="w-12 px-4 py-3">
                <SelectionCheckbox
                  aria-label={t('انتخاب همه میزبان‌های نمایان')}
                  disabled={disabled || !selectable.length}
                  checked={checked > 0 && checked === selectable.length}
                  mixed={checked > 0 && checked < selectable.length}
                  onChange={(e) => toggle(selectable, e.target.checked)}
                />
              </th>
              <th className="px-2 py-3 text-start font-medium">
                {t('میزبان')}
              </th>
              <th className="hidden px-4 py-3 text-start font-medium md:table-cell">
                {t('آدرس و پورت')}
              </th>
              <th className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                {t('اینباند')}
              </th>
              <th className="px-4 py-3 text-start font-medium">
                {t('پروتکل')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map(({ inbound, host }, index) => (
              <tr
                key={`${inboundKey(inbound)}:${host.id ?? index}`}
                className={
                  isSelected(inbound, host.id)
                    ? 'bg-primary/5'
                    : 'hover:bg-muted/40'
                }
              >
                <td className="px-4 py-3">
                  <SelectionCheckbox
                    id={`${id}-${index}`}
                    aria-label={`${host.remark || host.address} · ${inbound.tag}`}
                    checked={isSelected(inbound, host.id)}
                    disabled={
                      disabled ||
                      !host.id ||
                      host.disabled ||
                      isRequired(inbound, host.id)
                    }
                    onChange={(e) =>
                      toggle([{ inbound, host }], e.target.checked)
                    }
                  />
                </td>
                <td className="max-w-64 break-words px-2 py-3">
                  <label
                    htmlFor={`${id}-${index}`}
                    className="cursor-pointer font-medium"
                    dir="auto"
                  >
                    {host.remark || host.address}
                  </label>
                  <span
                    className="mt-1 block break-all text-xs text-muted-foreground md:hidden"
                    dir="ltr"
                  >
                    {host.address}:{host.port ?? inbound.port ?? '—'}
                  </span>
                  {host.disabled && (
                    <span className="block text-xs text-muted-foreground">
                      {t('غیرفعال در سرور')}
                    </span>
                  )}
                  {isRequired(inbound, host.id) && (
                    <span className="block text-xs text-primary">
                      {t('الزامی برای همه')}
                    </span>
                  )}
                </td>
                <td
                  className="hidden max-w-80 break-all px-4 py-3 text-muted-foreground md:table-cell"
                  dir="ltr"
                >
                  {host.address}:{host.port ?? inbound.port ?? '—'}
                </td>
                <td
                  className="hidden max-w-48 break-words px-4 py-3 text-xs text-muted-foreground lg:table-cell"
                  dir="auto"
                >
                  {inbound.tag}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-md border bg-background px-2 py-1 font-mono text-[11px]">
                    {inbound.protocol.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {t('میزبانی پیدا نشد')}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>{t('{0} میزبان نمایان', { 0: visible.length })}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => toggle(selectable, true)}
          >
            {t('انتخاب همه موارد نمایان')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => toggle(selectable, false)}
          >
            {t('حذف انتخاب موارد نمایان')}
          </Button>
        </div>
      </div>
    </section>
  )
}
