import { useI18n } from '#/components/locale-provider'
import * as React from 'react'
import { useTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnVisibilityState,
  SortingState,
} from '@tanstack/react-table'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Settings2Icon,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { createResellerColumns } from './columns'
import type { ResellerRow, ResellerTableMeta } from './columns'
import { features } from './data-table-features'
import type { DataTableFeatures } from './data-table-features'

const COLUMN_LABELS: Record<string, string> = {
  name: 'نام',
  email: 'ایمیل',
  usernameSuffix: 'پسوند',
  pricePerGbToman: 'قیمت هر گیگ',
  balanceToman: 'موجودی کیف پول',
  allowUnlimitedExpire: 'انقضا',
  status: 'وضعیت',
}

type ResellersDataTableProps = {
  data: ResellerRow[]
  loading?: boolean
  onEdit: (reseller: ResellerRow) => void
  onQuickBalance?: (reseller: ResellerRow) => void
  onHistory?: (reseller: ResellerRow) => void
}

export function ResellersDataTable({
  data,
  loading = false,
  onEdit,
  onQuickBalance,
  onHistory,
}: ResellersDataTableProps) {
  const { t, numberLocale, formatToman } = useI18n()

  const columns = React.useMemo(
    () => createResellerColumns({ t, formatToman }),
    [t, formatToman],
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  )
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({
      search: false,
    })
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })

  const meta = React.useMemo<ResellerTableMeta>(
    () => ({ onEdit, onQuickBalance, onHistory }),
    [onEdit, onQuickBalance, onHistory],
  )

  const table = useTable({
    features,
    data,
    columns: columns as ColumnDef<DataTableFeatures, ResellerRow>[],
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    meta,
  })

  const searchValue =
    (table.getColumn('search')?.getFilterValue() as string | undefined) ?? ''

  const pageCount = Math.max(table.getPageCount(), 1)
  const pageIndex = table.state.pagination.pageIndex
  const pageSize = table.state.pagination.pageSize
  const filteredCount = table.getFilteredRowModel().rows.length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder={t('جستجو نام، ایمیل یا پسوند…')}
          value={searchValue}
          onChange={(event) => {
            table.getColumn('search')?.setFilterValue(event.target.value)
            table.setPageIndex(0)
          }}
          className="w-full sm:max-w-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="h-8 shrink-0" />
            }
          >
            <Settings2Icon className="size-4 ltr:rotate-180" />
            {t('ستون‌ها')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('نمایش ستون‌ها')}</DropdownMenuLabel>
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== 'undefined' &&
                    column.getCanHide() &&
                    column.id !== 'search',
                )
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {t(COLUMN_LABELS[column.id] ?? column.id)}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={header.id === 'actions' ? 'w-12' : undefined}
                  >
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {table.getVisibleLeafColumns().map((column) => (
                    <TableCell key={column.id}>
                      <Skeleton className="h-5 w-full max-w-[140px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-28 text-center text-sm text-muted-foreground"
                >
                  {searchValue
                    ? t('نتیجه‌ای برای این جستجو پیدا نشد')
                    : t('هنوز نماینده‌ای ثبت نشده است')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {filteredCount.toLocaleString(numberLocale)} {t('نماینده')}
        </p>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm whitespace-nowrap">{t('در هر صفحه')}</span>
            <Select
              items={[10, 20, 30, 50].map((size) => ({
                value: String(size),
                label: size.toLocaleString(numberLocale),
              }))}
              value={String(pageSize)}
              onValueChange={(value) => {
                if (value) table.setPageSize(Number(value))
              }}
            >
              <SelectTrigger className="h-8 w-[4.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 50].map((pageSize) => (
                  <SelectItem
                    key={pageSize}
                    value={String(pageSize)}
                    label={pageSize.toLocaleString(numberLocale)}
                  >
                    {pageSize.toLocaleString(numberLocale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm font-medium tabular-nums">
            {t('صفحه')} {(pageIndex + 1).toLocaleString(numberLocale)} {t('از')}{' '}
            {pageCount.toLocaleString(numberLocale)}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              className="hidden size-8 lg:inline-flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">{t('صفحه اول')}</span>
              <ChevronsRightIcon className="size-4 ltr:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">{t('صفحه قبل')}</span>
              <ChevronRightIcon className="size-4 ltr:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">{t('صفحه بعد')}</span>
              <ChevronLeftIcon className="size-4 ltr:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="hidden size-8 lg:inline-flex"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">{t('صفحه آخر')}</span>
              <ChevronsLeftIcon className="size-4 ltr:rotate-180" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
