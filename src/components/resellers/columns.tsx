import { useI18n } from '#/components/locale-provider'
import { createColumnHelper } from '@tanstack/react-table'
import {
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  WalletIcon,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { statusColor, statusLabel } from '#/lib/format'

import { DataTableColumnHeader } from './data-table-column-header'
import type { DataTableFeatures } from './data-table-features'

export type ResellerRow = {
  id: string
  name: string
  email: string
  status: string | null
  usernameSuffix: string | null
  pricePerGbToman: number | null
  allowUnlimitedExpire: boolean | null
  notes: string | null
  balanceToman?: number
  creditLimitToman?: number | null
}

export type ResellerTableMeta = {
  onEdit: (reseller: ResellerRow) => void
  onQuickBalance?: (reseller: ResellerRow) => void
  onHistory?: (reseller: ResellerRow) => void
}

const columnHelper = createColumnHelper<DataTableFeatures, ResellerRow>()

export function createResellerColumns({
  t,
  formatToman,
}: Pick<ReturnType<typeof useI18n>, 't' | 'formatToman'>) {
  return columnHelper.columns([
    columnHelper.accessor(
      (row) =>
        [row.name, row.email, row.usernameSuffix ?? '', row.notes ?? ''].join(
          ' ',
        ),
      {
        id: 'search',
        header: t('جستجو'),
        enableHiding: false,
        enableSorting: false,
        filterFn: 'includesString',
      },
    ),
    columnHelper.accessor('name', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('نام')} />
      ),
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <p className="font-medium">{row.original.name}</p>
          {row.original.notes ? (
            <p className="max-w-[220px] truncate text-xs text-muted-foreground">
              {row.original.notes}
            </p>
          ) : null}
        </div>
      ),
      sortFn: 'text',
    }),
    columnHelper.accessor('email', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('ایمیل')} />
      ),
      cell: ({ getValue }) => (
        <span className="font-mono text-sm" dir="ltr">
          {getValue()}
        </span>
      ),
      sortFn: 'text',
    }),
    columnHelper.accessor('usernameSuffix', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('پسوند')} />
      ),
      cell: ({ getValue }) => {
        const suffix = getValue()
        return (
          <span className="font-mono text-sm" dir="ltr">
            {suffix ?? '—'}
          </span>
        )
      },
      sortFn: 'text',
    }),
    columnHelper.accessor('pricePerGbToman', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('قیمت هر گیگ')} />
      ),
      cell: ({ getValue }) => formatToman(getValue()),
      sortFn: 'alphanumeric',
    }),
    columnHelper.accessor('balanceToman', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('موجودی کیف پول')} />
      ),
      cell: ({ row, table }) => {
        const meta = table.options.meta as ResellerTableMeta | undefined
        const balance = row.original.balanceToman ?? 0
        const limit = row.original.creditLimitToman
        return (
          <button
            type="button"
            className="group flex flex-col items-start rounded-lg p-1 text-start transition hover:bg-muted/70 cursor-pointer"
            onClick={() => meta?.onQuickBalance?.(row.original)}
            title={t('کلیک برای تنظیم یا شارژ سریع موجودی')}
          >
            <span
              className={`font-semibold group-hover:underline ${
                balance > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : balance < 0
                    ? 'text-destructive'
                    : 'text-muted-foreground'
              }`}
            >
              {formatToman(balance)}
            </span>
            {limit != null ? (
              <span className="text-[11px] text-muted-foreground">
                {t('سقف:')} {formatToman(limit)}
              </span>
            ) : null}
          </button>
        )
      },
      sortFn: 'alphanumeric',
    }),
    columnHelper.accessor('allowUnlimitedExpire', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('انقضا')} />
      ),
      cell: ({ getValue }) =>
        getValue() ? (
          <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            {t('نامحدود مجاز')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{t('زمان‌دار')}</span>
        ),
      enableSorting: false,
    }),
    columnHelper.accessor('status', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('وضعیت')} />
      ),
      cell: ({ getValue }) => {
        const status = getValue() || 'active'
        return (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(status)}`}
          >
            {t(statusLabel(status))}
          </span>
        )
      },
      enableSorting: false,
    }),
    columnHelper.display({
      id: 'actions',
      enableHiding: false,
      header: () => <span className="sr-only">{t('عملیات')}</span>,
      cell: ({ row, table }) => {
        const reseller = row.original
        const meta = table.options.meta as ResellerTableMeta | undefined

        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" className="size-8" />
                }
              >
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">{t('باز کردن منو')}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t('عملیات نماینده')}</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => meta?.onQuickBalance?.(reseller)}
                    className="gap-2 cursor-pointer"
                  >
                    <WalletIcon className="size-4 text-emerald-600" />
                    {t('تنظیم / شارژ موجودی')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => meta?.onHistory?.(reseller)}
                    className="gap-2 cursor-pointer"
                  >
                    <HistoryIcon className="size-4 text-primary" />
                    {t('گردش حساب کیف پول')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => meta?.onEdit(reseller)}
                    className="gap-2 cursor-pointer"
                  >
                    <PencilIcon className="size-4" />
                    {t('ویرایش تنظیمات حساب')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    }),
  ])
}
