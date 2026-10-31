import { useI18n } from '#/components/locale-provider'
import { remainingDays, remainingTrafficBytes } from '#/lib/vpn-usage'
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ContactRoundIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PowerIcon,
  QrCodeIcon,
  RefreshCwIcon,
  UnlinkIcon,
} from 'lucide-react'
import { cn } from 'cn'

import type { ManageVpnUser } from '#/components/vpn-users/manage-vpn-user-sheet'
import { SubscriptionShareDialog } from '#/components/vpn-users/subscription-share-dialog'
import type { SubscriptionShareTarget } from '#/components/vpn-users/subscription-share-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { statusColor, statusLabel } from '#/lib/format'

export type VpnUserRow = ManageVpnUser & {
  status: string
  resellerId?: string
  billingStatus?: 'settled' | 'claimed' | 'outstanding' | null
  removedAt?: string | null
  contactPhone?: string | null
  contactTelegram?: string | null
  labels?: string[]
}

export type VpnUserActionType =
  | 'disable'
  | 'enable'
  | 'revoke'
  | 'sync'
  | 'archive'

type ConfirmableAction = VpnUserActionType

type PendingConfirm = {
  type: ConfirmableAction
  user: VpnUserRow
}

const ACTION_COPY: Record<
  ConfirmableAction,
  { title: string; description: string; confirm: string; destructive?: boolean }
> = {
  disable: {
    title: 'غیرفعال‌سازی کاربر',
    description: 'دسترسی این کاربر به VPN تا فعال‌سازی مجدد قطع می‌شود.',
    confirm: 'غیرفعال کن',
  },
  enable: {
    title: 'فعال‌سازی کاربر',
    description: 'کاربر دوباره می‌تواند به VPN متصل شود.',
    confirm: 'فعال کن',
  },
  sync: {
    title: 'به‌روزرسانی اطلاعات',
    description: 'وضعیت، مصرف و لینک اشتراک این کاربر دوباره خوانده می‌شود.',
    confirm: 'به‌روزرسانی',
  },
  revoke: {
    title: 'لغو لینک اشتراک',
    description: 'لینک فعلی باطل می‌شود و باید لینک جدید برای کاربر ارسال شود.',
    confirm: 'لغو اشتراک',
    destructive: true,
  },
  archive: {
    title: 'آرشیو کاربر',
    description:
      'کاربر از دسترس خارج و لینک مشتری باطل می‌شود. تاریخچه مالی و حسابرسی حفظ می‌شود.',
    confirm: 'آرشیو کن',
    destructive: true,
  },
}

export function VpnUsersList({
  users,
  loading,
  busy,
  onManage,
  onContact,
  onAction,
  allowArchive = false,
}: {
  users: VpnUserRow[]
  loading?: boolean
  busy?: boolean
  onManage: (user: VpnUserRow) => void
  onContact?: (user: VpnUserRow) => void
  onAction: (type: VpnUserActionType, user: VpnUserRow) => void | Promise<void>
  allowArchive?: boolean
}) {
  const { t } = useI18n()

  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [shareTarget, setShareTarget] =
    useState<SubscriptionShareTarget | null>(null)

  function requestAction(type: VpnUserActionType, user: VpnUserRow) {
    setPending({ type, user })
  }

  function openShare(user: VpnUserRow) {
    if (!user.subscriptionUrl) return
    setShareTarget({
      username: user.marzbanUsername,
      subscriptionUrl: user.subscriptionUrl,
    })
  }

  async function confirmAction() {
    if (!pending || busy) return
    const { type, user } = pending
    try {
      await onAction(type, user)
      setPending(null)
    } catch {
      // Keep dialog open so the user can retry or cancel.
    }
  }

  const copy = pending ? ACTION_COPY[pending.type] : null

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {users.map((user) => (
          <VpnUserCard
            key={user.id}
            user={user}
            busy={busy}
            onManage={() => onManage(user)}
            onContact={onContact ? () => onContact(user) : undefined}
            onShare={() => openShare(user)}
            onAction={(type) => requestAction(type, user)}
            allowArchive={allowArchive}
          />
        ))}
        {!loading && users.length === 0 ? (
          <EmptyState className="rounded-2xl border border-dashed p-10" />
        ) : null}
      </div>

      <div className="hidden md:block">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11">{t('نام کاربری')}</TableHead>
                  <TableHead className="h-11">{t('وضعیت')}</TableHead>
                  <TableHead className="h-11 min-w-44">{t('مصرف')}</TableHead>
                  <TableHead className="h-11">{t('انقضا')}</TableHead>
                  <TableHead className="h-11 text-end">{t('عملیات')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className="group">
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className="truncate font-mono text-sm font-medium"
                          dir="ltr"
                        >
                          {user.marzbanUsername}
                        </span>
                        {user.note ? (
                          <span className="max-w-56 truncate text-xs text-muted-foreground">
                            {user.note}
                          </span>
                        ) : null}
                        <ContactLine user={user} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={user.status} />
                        <BillingBadge status={user.billingStatus} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <UsageMeter
                        used={user.usedTrafficBytes}
                        limit={user.dataLimitBytes}
                      />
                    </TableCell>
                    <TableCell>
                      <ExpireCell expireAt={user.expireAt} />
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onManage(user)}
                        >
                          {t('تمدید / ویرایش')}
                        </Button>
                        {onContact ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => onContact(user)}
                          >
                            <ContactRoundIcon className="size-3.5" />
                            <span className="sr-only">{t('اطلاعات مشتری')}</span>
                          </Button>
                        ) : null}
                        {user.subscriptionUrl ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openShare(user)}
                          >
                            <QrCodeIcon className="size-3.5" />
                            <span className="sr-only">{t('QR / اشتراک')}</span>
                          </Button>
                        ) : null}
                        <UserActionsPopover
                          user={user}
                          busy={busy}
                          onManage={() => onManage(user)}
                          onShare={() => openShare(user)}
                          onAction={(type) => requestAction(type, user)}
                          allowArchive={allowArchive}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && users.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="h-28 text-center">
                      <EmptyState />
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <AlertDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(copy?.title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? (
                <>
                  {t(copy?.description)}{' '}
                  <span
                    className="font-mono font-medium text-foreground"
                    dir="ltr"
                  >
                    {pending.user.marzbanUsername}
                  </span>
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('انصراف')}</AlertDialogCancel>
            <AlertDialogAction
              variant={copy?.destructive ? 'destructive' : 'default'}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void confirmAction()
              }}
            >
              {busy ? t('در حال انجام…') : t(copy?.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SubscriptionShareDialog
        target={shareTarget}
        open={shareTarget != null}
        onOpenChange={(next) => {
          if (!next) setShareTarget(null)
        }}
      />
    </>
  )
}

function VpnUserCard({
  user,
  busy,
  onManage,
  onContact,
  onShare,
  onAction,
  allowArchive = false,
}: {
  user: VpnUserRow
  busy?: boolean
  onManage: () => void
  onContact?: () => void
  onShare: () => void
  onAction: (type: VpnUserActionType) => void
  allowArchive?: boolean
}) {
  const { t } = useI18n()

  return (
    <article className="rounded-2xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate font-mono text-sm font-semibold" dir="ltr">
            {user.marzbanUsername}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={user.status} />
            <BillingBadge status={user.billingStatus} />
          </div>
          <ContactLine user={user} />
        </div>
        <UserActionsPopover
          user={user}
          busy={busy}
          onManage={onManage}
          onShare={onShare}
          onAction={onAction}
          allowArchive={allowArchive}
        />
      </div>

      <div className="mt-4 space-y-3">
        <UsageMeter
          used={user.usedTrafficBytes}
          limit={user.dataLimitBytes}
          dense
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t('انقضا')}</span>
          <ExpireCell expireAt={user.expireAt} />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button className="h-11 flex-1" onClick={onManage}>
          {t('تمدید / ویرایش')}
        </Button>
        {onContact ? (
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={onContact}
          >
            <ContactRoundIcon className="size-4" />
            <span className="sr-only">{t('اطلاعات مشتری')}</span>
          </Button>
        ) : null}
        {user.subscriptionUrl ? (
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={onShare}
          >
            <QrCodeIcon className="size-4" />
            <span className="sr-only">{t('QR / اشتراک')}</span>
          </Button>
        ) : null}
      </div>
    </article>
  )
}

function ContactLine({ user }: { user: VpnUserRow }) {
  const { t } = useI18n()

  const labels = user.labels ?? []
  if (!user.contactPhone && !user.contactTelegram && labels.length === 0)
    return null
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {user.contactPhone ? <span dir="ltr">{user.contactPhone}</span> : null}
      {user.contactTelegram ? (
        <a
          className="underline-offset-2 hover:underline"
          dir="ltr"
          href={`https://t.me/${encodeURIComponent(user.contactTelegram)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          @{user.contactTelegram}
        </a>
      ) : null}
      {labels.map((label) => (
        <span
          key={t(label)}
          className="rounded-full border px-1.5 py-0.5 text-[10px]"
        >
          {t(label)}
        </span>
      ))}
    </div>
  )
}

function UserActionsPopover({
  user,
  busy,
  onManage,
  onShare,
  onAction,
  allowArchive = false,
}: {
  user: VpnUserRow
  busy?: boolean
  onManage: () => void
  onShare: () => void
  onAction: (type: VpnUserActionType) => void
  allowArchive?: boolean
}) {
  const { t } = useI18n()

  const [open, setOpen] = useState(false)

  function run(action: () => void) {
    setOpen(false)
    // Close popover before opening dialog / running side effects.
    setTimeout(action, 0)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            disabled={busy}
          />
        }
      >
        <MoreHorizontalIcon className="size-4" />
        <span className="sr-only">{t('عملیات')}</span>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-56 gap-1 p-1.5">
        <PopoverHeader className="px-2 py-1.5">
          <PopoverTitle className="text-xs text-muted-foreground">
            {t('عملیات کاربر')}
          </PopoverTitle>
        </PopoverHeader>
        <ActionButton
          icon={<PencilIcon />}
          label={t('تمدید / ویرایش')}
          onClick={() => run(onManage)}
        />
        {allowArchive ? (
          <ActionButton
            icon={<UnlinkIcon />}
            label={t('آرشیو کاربر')}
            destructive
            onClick={() => run(() => onAction('archive'))}
          />
        ) : null}
        <ActionButton
          icon={<PowerIcon />}
          label={user.status === 'disabled' ? t('فعال‌سازی') : t('غیرفعال‌سازی')}
          onClick={() =>
            run(() =>
              onAction(user.status === 'disabled' ? 'enable' : 'disable'),
            )
          }
        />
        <ActionButton
          icon={<RefreshCwIcon />}
          label={t('به‌روزرسانی')}
          onClick={() => run(() => onAction('sync'))}
        />
        <ActionButton
          icon={<UnlinkIcon />}
          label={t('لغو اشتراک')}
          onClick={() => run(() => onAction('revoke'))}
        />
        {user.subscriptionUrl ? (
          <ActionButton
            icon={<QrCodeIcon />}
            label={t('QR / اشتراک')}
            onClick={() => run(onShare)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  const { t } = useI18n()

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-start text-sm transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'hover:bg-muted',
      )}
    >
      <span className="[&>svg]:size-4">{icon}</span>
      {t(label)}
    </button>
  )
}

function BillingBadge({
  status,
}: {
  status?: 'settled' | 'claimed' | 'outstanding' | null
}) {
  const { t } = useI18n()

  if (!status) return null
  if (status === 'settled') {
    return (
      <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        {t('تسویه')}
      </Badge>
    )
  }
  if (status === 'claimed') {
    return (
      <Badge className="border-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">
        {t('ادعای پرداخت')}
      </Badge>
    )
  }
  return (
    <Badge className="border-0 bg-destructive/10 text-destructive">
      {t('بدهی')}
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()

  return (
    <Badge variant="secondary" className={cn('border-0', statusColor(status))}>
      {t(statusLabel(status))}
    </Badge>
  )
}

function UsageMeter({
  used,
  limit,
  dense,
}: {
  used: number
  limit: number | null
  dense?: boolean
}) {
  const { formatBytes, t } = useI18n()

  const ratio =
    limit != null && limit > 0 ? Math.min(1, Math.max(0, used / limit)) : null
  const percent = ratio == null ? null : Math.round(ratio * 100)
  const tone =
    percent == null
      ? 'bg-primary'
      : percent >= 90
        ? 'bg-destructive'
        : percent >= 70
          ? 'bg-amber-500'
          : 'bg-primary'

  return (
    <div className={cn('space-y-1.5', dense ? 'min-w-0' : 'min-w-40')}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {formatBytes(used)}
          <span className="mx-1 opacity-50">/</span>
          {formatBytes(limit === 0 ? null : limit)}
        </span>
        {percent != null ? (
          <span className="text-muted-foreground">
            {percent}
            {t('٪')}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('باقی‌مانده:')} {formatBytes(remainingTrafficBytes(used, limit))}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', tone)}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  )
}

function ExpireCell({ expireAt }: { expireAt: string | null }) {
  const { t, formatDate, numberLocale } = useI18n()

  const state = getExpireState(expireAt)
  if (state === 'none') {
    return (
      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
        {t('نامحدود')}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'text-sm',
        state === 'expired' && 'font-medium text-destructive',
        state === 'soon' && 'font-medium text-amber-600 dark:text-amber-400',
      )}
    >
      {formatDate(expireAt)}
      <span className="block text-xs text-muted-foreground">
        {remainingDays(expireAt)?.toLocaleString(numberLocale)}{' '}
        {t('روز باقی‌مانده')}
      </span>
    </span>
  )
}

function getExpireState(expireAt: string | null) {
  if (!expireAt) return 'none' as const
  const date = new Date(expireAt)
  if (Number.isNaN(date.getTime())) return 'none' as const
  const diff = date.getTime() - Date.now()
  if (diff <= 0) return 'expired' as const
  if (diff <= 3 * 24 * 60 * 60 * 1000) return 'soon' as const
  return 'ok' as const
}

function EmptyState({ className }: { className?: string }) {
  const { t } = useI18n()

  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      {t('هنوز کاربری ثبت نشده است')}
    </div>
  )
}
