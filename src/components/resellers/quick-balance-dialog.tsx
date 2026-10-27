import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { WalletIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'
import type { ResellerRow } from './columns'

const PRESET_AMOUNTS = [50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000]

export type QuickBalanceDialogProps = {
  reseller: ResellerRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuickBalanceDialog({
  reseller,
  open,
  onOpenChange,
}: QuickBalanceDialogProps) {
  const { t, formatToman } = useI18n()

  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'credit' | 'absolute'>('credit')
  const [amount, setAmount] = useState('')
  const [absoluteBalance, setAbsoluteBalance] = useState('')
  const [reason, setReason] = useState('')

  const walletQuery = useQuery({
    ...orpc.wallet.forReseller.queryOptions({
      input: { resellerId: reseller?.id ?? '' },
    }),
    enabled: Boolean(open && reseller?.id),
  })

  const currentBalance =
    walletQuery.data?.balanceToman ?? reseller?.balanceToman ?? 0
  const outstanding = walletQuery.data?.outstandingToman ?? 0
  const num = (v: string) => Number(v.replace(/[^\d]/g, ''))

  const refreshAll = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.admin.listResellers.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.wallet.forReseller.key(),
      }),
    ])

  const creditMutation = useMutation({
    mutationFn: (amountToman: number) =>
      orpc.wallet.adjust.call({
        resellerId: reseller!.id,
        type: 'credit',
        amountToman,
        reason: reason.trim() || t('شارژ سریع توسط مدیر'),
      }),
    onSuccess: async () => {
      await refreshAll()
      toastSuccess(t('شارژ با موفقیت انجام شد'))
      setAmount('')
      setReason('')
      onOpenChange(false)
    },
    onError: (err) => toastError(t('شارژ انجام نشد'), err),
  })

  const setBalanceMutation = useMutation({
    mutationFn: (targetBalanceToman: number) =>
      orpc.wallet.setBalance.call({
        resellerId: reseller!.id,
        targetBalanceToman,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      await refreshAll()
      toastSuccess(t('موجودی کیف پول تنظیم شد'))
      setAbsoluteBalance('')
      setReason('')
      onOpenChange(false)
    },
    onError: (err) => toastError(t('تنظیم موجودی انجام نشد'), err),
  })

  const isPending = creditMutation.isPending || setBalanceMutation.isPending

  if (!reseller) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <WalletIcon className="size-4" />
            </div>
            <div>
              <DialogTitle>
                {t('تنظیم موجودی:')} {reseller.name}
              </DialogTitle>
              <DialogDescription className="font-mono text-xs" dir="ltr">
                {reseller.email}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Summary Badges */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                {t('موجودی فعلی:')}
              </p>
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                {formatToman(currentBalance)}
              </p>
            </div>
            {outstanding > 0 ? (
              <div className="space-y-0.5 text-end">
                <p className="text-xs text-muted-foreground">
                  {t('بدهی باز:')}
                </p>
                <Badge
                  variant="outline"
                  className="border-destructive/30 text-destructive"
                >
                  {formatToman(outstanding)}
                </Badge>
              </div>
            ) : null}
          </div>

          {/* Mode Switcher */}
          <div className="flex rounded-lg bg-muted p-1 text-xs">
            <button
              type="button"
              className={`flex-1 rounded-md py-1.5 font-medium transition cursor-pointer ${
                tab === 'credit'
                  ? 'bg-background shadow-xs text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab('credit')}
            >
              {t('افزایش سریع (شارژ)')}
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md py-1.5 font-medium transition cursor-pointer ${
                tab === 'absolute'
                  ? 'bg-background shadow-xs text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab('absolute')}
            >
              {t('تنظیم موجودی نهایی')}
            </button>
          </div>

          {tab === 'credit' ? (
            <div className="space-y-3">
              {/* Presets */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {t('مبالغ آماده (۱ کلیک):')}
                </Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PRESET_AMOUNTS.map((val) => (
                    <Button
                      key={val}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-medium cursor-pointer"
                      disabled={isPending}
                      onClick={() => creditMutation.mutate(val)}
                    >
                      +{formatToman(val)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Custom amount */}
              <div className="space-y-1.5">
                <Label htmlFor="quick-credit-amount" className="text-xs">
                  {t('یا وارد کردن مبلغ دلخواه (تومان):')}
                </Label>
                <Input
                  id="quick-credit-amount"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="500000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="quick-target-balance" className="text-xs">
                {t('موجودی نهایی جدید (تومان):')}
              </Label>
              <Input
                id="quick-target-balance"
                dir="ltr"
                inputMode="numeric"
                placeholder={String(currentBalance)}
                value={absoluteBalance}
                onChange={(e) => setAbsoluteBalance(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('تفاضل به‌صورت خودکار محاسبه و در گردش حساب ثبت می‌شود.')}
              </p>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="quick-balance-reason" className="text-xs">
              {t('توضیح یا بابت (اختیاری):')}
            </Label>
            <Input
              id="quick-balance-reason"
              placeholder={t('مثلاً: شارژ نقدی حضوری / هدیه')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="mt-2 sm:justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('انصراف')}
          </Button>
          {tab === 'credit' ? (
            <Button
              type="button"
              disabled={!num(amount) || isPending}
              onClick={() => creditMutation.mutate(num(amount))}
            >
              {t('افزایش موجودی')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={absoluteBalance.trim() === '' || isPending}
              onClick={() => setBalanceMutation.mutate(num(absoluteBalance))}
            >
              {t('ثبت موجودی جدید')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
