import { useI18n } from '#/components/locale-provider'
import { useQuery } from '@tanstack/react-query'
import { HistoryIcon } from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

import { orpc } from '#/orpc/client'
import type { ResellerRow } from './columns'

export type ResellerHistorySheetProps = {
  reseller: ResellerRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ResellerHistorySheet({
  reseller,
  open,
  onOpenChange,
}: ResellerHistorySheetProps) {
  const { t, formatToman, formatDate, numberLocale, direction } = useI18n()

  const walletQuery = useQuery({
    ...orpc.wallet.forReseller.queryOptions({
      input: { resellerId: reseller?.id ?? '' },
    }),
    enabled: Boolean(open && reseller?.id),
  })

  if (!reseller) return null

  const w = walletQuery.data
  const entries = w?.entries ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'right' : 'left'}
        className="w-full sm:max-w-md p-0 flex flex-col"
      >
        <SheetHeader className="border-b p-4 text-start">
          <div className="flex items-center gap-2">
            <HistoryIcon className="size-5 text-muted-foreground" />
            <div>
              <SheetTitle>
                {t('گردش حساب:')} {reseller.name}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs" dir="ltr">
                {reseller.email}
              </SheetDescription>
            </div>
          </div>
          {w ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">
                {t('موجودی:')} {formatToman(w.balanceToman)}
              </Badge>
              <Badge variant="outline">
                {t('بدهی باز:')} {formatToman(w.outstandingToman)}
              </Badge>
              <Badge variant="outline">
                {t('سقف اعتبار:')}{' '}
                {w.creditLimitToman == null
                  ? t('نامحدود')
                  : formatToman(w.creditLimitToman)}
              </Badge>
            </div>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('تاریخ')}</TableHead>
                <TableHead>{t('شرح')}</TableHead>
                <TableHead className="text-end">{t('مبلغ')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {walletQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {t('در حال دریافت گردش حساب…')}
                  </TableCell>
                </TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {t('تراکنشی یافت نشد')}
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(e.createdAt)}
                    </TableCell>
                    <TableCell
                      className="max-w-[150px] truncate text-xs"
                      title={e.reason}
                    >
                      {e.reason}
                    </TableCell>
                    <TableCell
                      className={`text-end text-xs font-semibold tabular-nums whitespace-nowrap ${
                        e.type === 'credit'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-destructive'
                      }`}
                      dir="ltr"
                    >
                      {e.type === 'credit' ? '+' : '−'}
                      {e.amountToman.toLocaleString(numberLocale)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  )
}
