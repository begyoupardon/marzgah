import { useI18n } from '#/components/locale-provider'
import type { ComponentProps } from 'react'
import type { Column, RowData } from '@tanstack/react-table'
import { cn } from 'cn'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  EyeOffIcon,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

import type { DataTableFeatures } from './data-table-features'

type DataTableColumnHeaderProps<
  TData extends RowData,
  TValue,
> = ComponentProps<'div'> & {
  column: Column<DataTableFeatures, TData, TValue>
  title: string
}

export function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const { t } = useI18n()

  if (!column.getCanSort() && !column.getCanHide()) {
    return <div className={cn(className)}>{t(title)}</div>
  }

  const sorted = column.getIsSorted()

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          className={cn(
            '-ms-1.5 inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium outline-none select-none',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring/50',
            'data-popup-open:bg-accent data-popup-open:text-accent-foreground',
          )}
        >
          <span>{t(title)}</span>
          {column.getCanSort() ? (
            sorted === 'desc' ? (
              <ArrowDownIcon className="size-3.5 opacity-60" />
            ) : sorted === 'asc' ? (
              <ArrowUpIcon className="size-3.5 opacity-60" />
            ) : (
              <ChevronsUpDownIcon className="size-3.5 opacity-60" />
            )
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-36">
          <DropdownMenuGroup>
            {column.getCanSort() ? (
              <>
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => column.toggleSorting(false)}
                >
                  <ArrowUpIcon className="size-4" />
                  {t('صعودی')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onClick={() => column.toggleSorting(true)}
                >
                  <ArrowDownIcon className="size-4" />
                  {t('نزولی')}
                </DropdownMenuItem>
              </>
            ) : null}
            {column.getCanSort() && column.getCanHide() ? (
              <DropdownMenuSeparator />
            ) : null}
            {column.getCanHide() ? (
              <DropdownMenuItem
                className="gap-2"
                onClick={() => column.toggleVisibility(false)}
              >
                <EyeOffIcon className="size-4" />
                {t('مخفی کردن')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
