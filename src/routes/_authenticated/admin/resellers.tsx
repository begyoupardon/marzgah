import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import {
  CheckCircle2Icon,
  PlusIcon,
  UsersRoundIcon,
  WalletIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { UseFormSetError } from 'react-hook-form'

import { QueryErrorState } from '#/components/query-error-state'
import type { ResellerRow } from '#/components/resellers/columns'
import { ResellersDataTable } from '#/components/resellers/data-table'
import { QuickBalanceDialog } from '#/components/resellers/quick-balance-dialog'
import { ResellerControls } from '#/components/resellers/reseller-controls'
import { ResellerFormSheet } from '#/components/resellers/reseller-form-sheet'
import type {
  ResellerFormMode,
  ResellerFormTarget,
  ResellerFormValues,
} from '#/components/resellers/reseller-form-sheet'
import { ResellerHistorySheet } from '#/components/resellers/reseller-history-sheet'
import { Button } from '#/components/ui/button'
import { getErrorMessage, isConflictError } from '#/lib/errors'

import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated/admin/resellers')({
  beforeLoad: async ({ context }) => {
    const session = context.session
    if (session.user.role !== 'admin') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ResellerHubPage,
})

const authRoute = getRouteApi('/_authenticated')

type FormState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; reseller: ResellerFormTarget }

function ResellerHubPage() {
  const { t, formatToman } = useI18n()

  authRoute.useRouteContext()
  const queryClient = useQueryClient()

  const [formState, setFormState] = useState<FormState>({ open: false })
  const [quickBalanceTarget, setQuickBalanceTarget] =
    useState<ResellerRow | null>(null)
  const [historyTarget, setHistoryTarget] = useState<ResellerRow | null>(null)

  const listQuery = useQuery(orpc.admin.listResellers.queryOptions())

  const createMutation = useMutation({
    ...orpc.admin.createReseller.mutationOptions(),
  })

  const updateMutation = useMutation({
    ...orpc.admin.updateReseller.mutationOptions(),
  })

  function closeForm() {
    setFormState({ open: false })
  }

  function openCreate() {
    setFormState({ open: true, mode: 'create' })
  }

  function openEdit(reseller: ResellerRow) {
    setFormState({
      open: true,
      mode: 'edit',
      reseller: {
        id: reseller.id,
        name: reseller.name,
        email: reseller.email,
        status: reseller.status,
        usernameSuffix: reseller.usernameSuffix,
        pricePerGbToman: reseller.pricePerGbToman,
        allowUnlimitedExpire: reseller.allowUnlimitedExpire,
        notes: reseller.notes,
        balanceToman: reseller.balanceToman,
        creditLimitToman: reseller.creditLimitToman,
      },
    })
  }

  async function handleSubmit(
    values: ResellerFormValues,
    helpers: { setError: UseFormSetError<ResellerFormValues> },
  ) {
    if (!formState.open) return

    if (formState.mode === 'create') {
      try {
        await createMutation.mutateAsync({
          name: values.name,
          email: values.email,
          password: values.password,
          usernameSuffix: values.usernameSuffix,
          pricePerGbToman: values.pricePerGbToman,
          allowUnlimitedExpire: values.allowUnlimitedExpire,
          notes: values.notes.trim() ? values.notes.trim() : null,
          initialBalanceToman: values.initialBalanceToman ?? 0,
          creditLimitToman: values.creditLimitToman ?? null,
        })

        await queryClient.invalidateQueries({
          queryKey: orpc.admin.listResellers.key(),
        })
        closeForm()
        toastSuccess(t('نماینده با موفقیت ایجاد شد'))
      } catch (error) {
        if (isConflictError(error)) {
          helpers.setError('usernameSuffix', {
            type: 'manual',
            message: t('این پسوند نام کاربری قبلاً استفاده شده است'),
          })
          return
        }

        const message = t(getErrorMessage(error))
        if (/email/i.test(message)) {
          helpers.setError('email', {
            type: 'manual',
            message: t('این ایمیل قبلاً ثبت شده است'),
          })
          return
        }

        toastError(t('ایجاد نماینده با خطا مواجه شد'), error)
      }
      return
    }

    try {
      await updateMutation.mutateAsync({
        userId: formState.reseller.id,
        name: values.name,
        password: values.password.trim() ? values.password : undefined,
        usernameSuffix: values.usernameSuffix,
        pricePerGbToman: values.pricePerGbToman,
        allowUnlimitedExpire: values.allowUnlimitedExpire,
        status: values.status,
        notes: values.notes.trim() ? values.notes.trim() : null,
        creditLimitToman: values.creditLimitToman,
        targetBalanceToman: values.targetBalanceToman,
      })

      await queryClient.invalidateQueries({
        queryKey: orpc.admin.listResellers.key(),
      })
      closeForm()
      toastSuccess(t('اطلاعات نماینده به‌روزرسانی شد'))
    } catch (error) {
      if (isConflictError(error)) {
        helpers.setError('usernameSuffix', {
          type: 'manual',
          message: t('این پسوند نام کاربری قبلاً استفاده شده است'),
        })
        return
      }

      toastError(t('ویرایش نماینده با خطا مواجه شد'), error)
    }
  }

  const mode: ResellerFormMode =
    formState.open && formState.mode === 'edit' ? 'edit' : 'create'

  const sheetKey =
    formState.open && formState.mode === 'edit'
      ? `edit-${formState.reseller.id}`
      : 'create'

  const pending = createMutation.isPending || updateMutation.isPending

  const resellers = listQuery.data ?? []
  const activeCount = resellers.filter((r) => r.status === 'active').length
  const totalBalance = resellers.reduce(
    (acc, cur) => acc + (cur.balanceToman ?? 0),
    0,
  )

  const rows: ResellerRow[] = resellers.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    usernameSuffix: row.usernameSuffix,
    pricePerGbToman: row.pricePerGbToman,
    allowUnlimitedExpire: row.allowUnlimitedExpire,
    notes: row.notes,
    balanceToman: row.balanceToman ?? 0,
    creditLimitToman: row.creditLimitToman,
  }))

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('مدیریت نمایندگان')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('مدیریت حساب‌ها، تنظیم موجودی کیف پول و مدل مالی نمایندگان')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={openCreate} className="cursor-pointer">
            <PlusIcon /> {t('افزودن نماینده جدید')}
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {t('تعداد نمایندگان')}
            </p>
            <UsersRoundIcon className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-2xl font-bold">{resellers.length}</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {t('نمایندگان فعال')}
            </p>
            <CheckCircle2Icon className="size-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {activeCount}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {t('مجموع موجودی در گردش')}
            </p>
            <WalletIcon className="size-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold text-primary">
            {formatToman(totalBalance)}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {listQuery.error ? (
          <QueryErrorState
            error={listQuery.error}
            onRetry={() => void listQuery.refetch()}
          />
        ) : (
          <ResellersDataTable
            data={rows}
            loading={listQuery.isLoading}
            onEdit={openEdit}
            onQuickBalance={(r) => setQuickBalanceTarget(r)}
            onHistory={(r) => setHistoryTarget(r)}
          />
        )}

        <ResellerControls />
      </div>

      {/* Full Edit/Create Sheet */}
      <ResellerFormSheet
        key={sheetKey}
        open={formState.open}
        onOpenChange={(open) => {
          if (!open) closeForm()
        }}
        mode={mode}
        reseller={
          formState.open && formState.mode === 'edit'
            ? formState.reseller
            : null
        }
        pending={pending}
        onSubmit={handleSubmit}
      />

      {/* Quick 1-Click Balance Adjust Dialog */}
      <QuickBalanceDialog
        reseller={quickBalanceTarget}
        open={Boolean(quickBalanceTarget)}
        onOpenChange={(open) => {
          if (!open) setQuickBalanceTarget(null)
        }}
      />

      {/* Quick Wallet Statement Drawer */}
      <ResellerHistorySheet
        reseller={historyTarget}
        open={Boolean(historyTarget)}
        onOpenChange={(open) => {
          if (!open) setHistoryTarget(null)
        }}
      />
    </div>
  )
}
