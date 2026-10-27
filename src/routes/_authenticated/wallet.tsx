import { useI18n } from '#/components/locale-provider'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ReceiptIcon, ShieldAlertIcon, WalletIcon } from 'lucide-react'

import { QueryErrorState } from '#/components/query-error-state'
import { StatCard } from '#/components/stat-card'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/wallet')({
  beforeLoad: ({ context }) => {
    if (context.session.user.role === 'admin')
      throw redirect({ to: '/admin/resellers' })
  },
  component: WalletPage,
})

function WalletPage() {
  const { t, formatToman, formatDate, numberLocale } = useI18n()

  const walletQuery = useQuery(orpc.wallet.mine.queryOptions())
  const wallet = walletQuery.data
  const net = wallet ? wallet.balanceToman - wallet.outstandingToman : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('کیف پول و وضعیت مالی')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('مشاهده موجودی، بدهی‌های باز و گردش حساب کیف پول')}
          </p>
        </div>
        <Button variant="outline" render={<Link to="/sales" />}>
          <ReceiptIcon /> {t('تسویه و اعلام پرداخت')}
        </Button>
      </div>

      {walletQuery.error ? (
        <QueryErrorState
          error={walletQuery.error}
          onRetry={() => void walletQuery.refetch()}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title={t('موجودی کیف پول')}
          value={formatToman(wallet?.balanceToman ?? 0)}
          hint={t('وضعیت خالص: {0}', { '0': formatToman(net) })}
          icon={<WalletIcon className="size-4" />}
          tone={net < 0 ? 'danger' : 'good'}
          loading={walletQuery.isLoading}
        />
        <StatCard
          title={t('بدهی باز')}
          value={formatToman(wallet?.outstandingToman ?? 0)}
          hint={t('فروش‌های تسویه‌نشده')}
          icon={<ReceiptIcon className="size-4" />}
          tone={wallet?.outstandingToman ? 'danger' : undefined}
          loading={walletQuery.isLoading}
        />
        <StatCard
          title={t('مدل مالی / سقف اعتبار')}
          value={
            wallet?.creditLimitToman == null
              ? t('نامحدود (پس‌پرداخت)')
              : formatToman(wallet.creditLimitToman)
          }
          hint={
            wallet?.creditLimitToman == null
              ? t('امکان ساخت بدون موجودی اولیه')
              : t('حداکثر بدهی مجاز')
          }
          icon={<ShieldAlertIcon className="size-4" />}
          loading={walletQuery.isLoading}
        />
      </div>

      <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">
          {t('راهنمای مالی و تسویه:')}
        </p>
        <ul className="mt-1 list-inside list-disc space-y-1">
          <li>
            <strong>{t('نمایندگان پیش‌پرداخت:')}</strong>{' '}
            {t(
              'شارژ موجودی کیف پول توسط مدیر سیستم انجام می‌شود. ساخت کانفیگ به اندازه موجودی و سقف اعتبار مجاز خواهد بود.',
            )}
          </li>
          <li>
            <strong>{t('نمایندگان پس‌پرداخت:')}</strong>{' '}
            {t(
              'می‌توانید کانفیگ‌ها را بدون شارژ اولیه اضافه کنید؛ مبالغ در بخش بدهی ثبت می‌شوند و در صفحه',
            )}{' '}
            <Link to="/sales" className="text-primary hover:underline">
              {t('«تسویه و بدهی»')}
            </Link>{' '}
            {t('می‌توانید اعلام پرداخت کنید تا مدیر آن را تایید و تسویه نماید.')}
          </li>
        </ul>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t('گردش کیف پول')}</CardTitle>
          <CardDescription>
            {t('۵۰ تراکنش آخر ثبت شده در سامانه')}
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('تاریخ')}</TableHead>
                <TableHead>{t('شرح')}</TableHead>
                <TableHead>{t('مبلغ')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(wallet?.entries ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.createdAt)}</TableCell>
                  <TableCell className="max-w-xs truncate">
                    {e.reason}
                  </TableCell>
                  <TableCell
                    className={`${e.type === 'credit' ? 'text-emerald-600' : 'text-destructive'}`}
                    dir="ltr"
                  >
                    {e.type === 'credit' ? '+' : '−'}
                    {e.amountToman.toLocaleString(numberLocale)}
                  </TableCell>
                </TableRow>
              ))}
              {wallet?.entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {t('تراکنشی وجود ندارد')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
