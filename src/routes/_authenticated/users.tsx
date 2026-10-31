import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  getRouteApi,
  useNavigate,
} from '@tanstack/react-router'
import {
  DownloadIcon,
  RotateCcwIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as z from 'zod'

import { QueryErrorState } from '#/components/query-error-state'
import { Button } from '#/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '#/components/ui/input-group'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from '#/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { ContactDialog } from '#/components/vpn-users/contact-dialog'
import type { ContactTarget } from '#/components/vpn-users/contact-dialog'
import { CreateVpnUserDialog } from '#/components/vpn-users/create-vpn-user-dialog'
import { ManageVpnUserSheet } from '#/components/vpn-users/manage-vpn-user-sheet'
import type { ManageVpnUser } from '#/components/vpn-users/manage-vpn-user-sheet'
import { VpnUsersList } from '#/components/vpn-users/vpn-users-list'
import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

const ACTION_TOAST: Record<
  'disable' | 'enable' | 'revoke' | 'sync' | 'archive',
  { success: string; error: string }
> = {
  disable: {
    success: 'کاربر غیرفعال شد',
    error: 'غیرفعال‌سازی کاربر انجام نشد',
  },
  enable: {
    success: 'کاربر فعال شد',
    error: 'فعال‌سازی کاربر انجام نشد',
  },
  revoke: {
    success: 'لینک اشتراک لغو شد',
    error: 'لغو اشتراک انجام نشد',
  },
  sync: {
    success: 'اطلاعات کاربر به‌روز شد',
    error: 'به‌روزرسانی اطلاعات انجام نشد',
  },
  archive: { success: 'کاربر آرشیو شد', error: 'آرشیو کاربر انجام نشد' },
}

const VIEW_LABELS: Record<string, string> = {
  all: 'همه کاربران',
  expiring: 'در آستانه انقضا',
  high_usage: 'مصرف بالا (۹۰٪+)',
  unpaid: 'تسویه نشده',
}

const usersSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(1),
  pageSize: z.coerce
    .number()
    .pipe(z.union([z.literal(10), z.literal(20), z.literal(50)]))
    .optional()
    .catch(20),
  resellerId: z.string().optional().catch(undefined),
  view: z
    .enum(['expiring', 'high_usage', 'unpaid'])
    .optional()
    .catch(undefined),
  label: z.string().max(30).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/users')({
  validateSearch: usersSearchSchema,
  component: UsersPage,
})

const authRoute = getRouteApi('/_authenticated')

function UsersPage() {
  const { t, numberLocale } = useI18n()

  const { session } = authRoute.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [manageUser, setManageUser] = useState<ManageVpnUser | null>(null)
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const [contactUser, setContactUser] = useState<ContactTarget | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<number | null>(null)

  const isAdmin = session.user.role === 'admin'
  const page = search.page ?? 1
  const pageSize = search.pageSize ?? 20
  const filterResellerId = search.resellerId ?? ''
  const query = search.q?.trim() ?? ''

  useEffect(() => {
    setSearchInput(search.q ?? '')
  }, [search.q])

  useEffect(() => {
    const nextQ = searchInput.trim()
    if (nextQ === query) return
    // Cancel pending input when filters reset or browser navigation changes q.
    const timer = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, q: nextQ || undefined, page: 1 }),
        replace: true,
      })
    }, 350)
    searchTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (searchTimerRef.current === timer) searchTimerRef.current = null
    }
  }, [searchInput, navigate, query])

  const listQuery = useQuery(
    orpc.vpnUsers.list.queryOptions({
      input: {
        page,
        pageSize,
        ...(query ? { q: query } : {}),
        ...(isAdmin && filterResellerId
          ? { resellerId: filterResellerId }
          : {}),
        ...(search.view ? { view: search.view } : {}),
        ...(search.label ? { label: search.label } : {}),
      },
      refetchInterval: 30_000,
    }),
  )

  const resellersQuery = useQuery({
    ...orpc.admin.listResellers.queryOptions(),
    enabled: isAdmin,
  })

  const meQuery = useQuery({
    ...orpc.me.queryOptions(),
    enabled: !isAdmin,
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: orpc.vpnUsers.list.key(),
    })
  }

  const actionMutation = useMutation({
    mutationFn: async (args: {
      type: 'disable' | 'enable' | 'revoke' | 'sync' | 'archive'
      username: string
    }) => {
      if (args.type === 'disable') {
        return orpc.vpnUsers.update.call({
          username: args.username,
          status: 'disabled',
        })
      }
      if (args.type === 'enable') {
        return orpc.vpnUsers.update.call({
          username: args.username,
          status: 'active',
        })
      }
      if (args.type === 'revoke') {
        return orpc.vpnUsers.revokeSub.call({ username: args.username })
      }
      if (args.type === 'archive') {
        return orpc.vpnUsers.delete.call({ username: args.username })
      }
      return orpc.vpnUsers.sync.call({ username: args.username })
    },
    onSuccess: async (_data, vars) => {
      await invalidate()
      toastSuccess(ACTION_TOAST[vars.type].success, vars.username)
    },
    onError: (err, vars) => {
      toastError(ACTION_TOAST[vars.type].error, err)
    },
  })

  const exportMutation = useMutation({
    mutationFn: () =>
      orpc.tools.exportUsers.call({
        ...(isAdmin && filterResellerId
          ? { resellerId: filterResellerId }
          : {}),
        ...(search.view ? { view: search.view } : {}),
        ...(search.label ? { label: search.label } : {}),
      }),
    onSuccess: ({ csv, filename }) => {
      const url = URL.createObjectURL(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (err) => toastError(t('خروجی گرفتن انجام نشد'), err),
  })

  const importMutation = useMutation({
    mutationFn: async (file: File) =>
      orpc.tools.importUsers.call({ csv: await file.text() }),
    onSuccess: async ({ results, succeeded }) => {
      await invalidate()
      const failed = results.filter((r) => !r.ok)
      if (failed.length === 0) {
        toastSuccess(
          t('{0} کاربر ساخته شد', {
            '0': succeeded.toLocaleString(numberLocale),
          }),
        )
      } else {
        toastError(
          t('{0} موفق، {1} ناموفق', {
            '0': succeeded.toLocaleString(numberLocale),
            '1': failed.length.toLocaleString(numberLocale),
          }),
          new Error(
            failed
              .slice(0, 3)
              .map((f) => t('ردیف {0}: {1}', { '0': f.row, '1': f.error }))
              .join(' | '),
          ),
        )
      }
    },
    onError: (err) => toastError(t('ورود فایل انجام نشد'), err),
  })

  const managePrice = useMemo(() => {
    if (!manageUser) return null
    if (!isAdmin) return meQuery.data?.profile?.pricePerGbToman ?? null
    const resellerId =
      'resellerId' in manageUser
        ? (manageUser as ManageVpnUser & { resellerId?: string }).resellerId
        : undefined
    if (!resellerId) return null
    const reseller = (resellersQuery.data ?? []).find(
      (r) => r.id === resellerId,
    )
    return reseller?.pricePerGbToman ?? null
  }, [
    isAdmin,
    manageUser,
    meQuery.data?.profile?.pricePerGbToman,
    resellersQuery.data,
  ])

  const users = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const pageCount = listQuery.data?.pageCount ?? 1
  const currentPage = listQuery.data?.page ?? page

  function setSearchParams(
    patch: Partial<{
      q: string | undefined
      page: number
      pageSize: 10 | 20 | 50
      resellerId: string | undefined
      view: 'expiring' | 'high_usage' | 'unpaid' | undefined
      label: string | undefined
    }>,
  ) {
    void navigate({
      search: (prev) => ({
        ...prev,
        ...patch,
      }),
    })
  }

  const hasActiveFilters = Boolean(
    searchInput || query || filterResellerId || search.view || search.label,
  )

  function clearPendingSearch() {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
    setSearchInput('')
  }

  function resetFilters() {
    clearPendingSearch()
    searchInputRef.current?.focus()
    setSearchParams({
      q: undefined,
      resellerId: undefined,
      view: undefined,
      label: undefined,
      page: 1,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('کاربران VPN')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('مدیریت کاربران VPN حساب شما')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 sm:h-8"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            <DownloadIcon /> {t('خروجی CSV')}
          </Button>
          <input
            ref={importInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importMutation.mutate(file)
              e.target.value = ''
            }}
          />
          <Button
            variant="outline"
            className="h-11 sm:h-8"
            disabled={importMutation.isPending}
            onClick={() => importInput.current?.click()}
          >
            <UploadIcon /> {t('ورود CSV')}
          </Button>
          <Button className="h-11 sm:h-8" onClick={() => setOpen(true)}>
            {t('ایجاد کاربر')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <InputGroup className="h-11 w-full sm:h-9 sm:max-w-sm">
          <InputGroupAddon align="inline-start">
            <SearchIcon className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchInputRef}
            placeholder={t('جستجوی نام کاربری یا یادداشت…')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t('جستجوی کاربران')}
          />
          {searchInput ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t('پاک کردن جستجو')}
                onClick={() => {
                  clearPendingSearch()
                  setSearchParams({ q: undefined, page: 1 })
                }}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {isAdmin ? (
          <Select
            items={(resellersQuery.data ?? []).map((r) => ({
              value: r.id,
              label: `${r.name} (${r.email})`,
            }))}
            value={filterResellerId || null}
            onValueChange={(value) =>
              setSearchParams({
                resellerId: value || undefined,
                page: 1,
              })
            }
          >
            <SelectTrigger className="h-11 w-full sm:h-9 sm:w-56">
              <SelectValue placeholder={t('فیلتر بر اساس نماینده')} />
            </SelectTrigger>
            <SelectContent>
              {(resellersQuery.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id} description={r.email}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select
          items={Object.fromEntries(
            Object.entries(VIEW_LABELS).map(([value, label]) => [
              value,
              t(label),
            ]),
          )}
          value={search.view ?? 'all'}
          onValueChange={(value) =>
            setSearchParams({
              view:
                value === 'all'
                  ? undefined
                  : (value as 'expiring' | 'high_usage' | 'unpaid'),
              page: 1,
            })
          }
        >
          <SelectTrigger className="h-11 w-full sm:h-9 sm:w-44">
            <SelectValue placeholder={t('نمای کاربران')} />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(VIEW_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value} label={t(label)}>
                {t(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={{
            '10': t('۱۰ در صفحه'),
            '20': t('۲۰ در صفحه'),
            '50': t('۵۰ در صفحه'),
          }}
          value={String(pageSize)}
          onValueChange={(value) => {
            const next = Number(value) as 10 | 20 | 50
            setSearchParams({ pageSize: next, page: 1 })
          }}
        >
          <SelectTrigger className="h-11 w-full sm:h-9 sm:w-36">
            <SelectValue placeholder={t('تعداد در صفحه')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10" label={t('۱۰ در صفحه')}>
              {t('۱۰ در صفحه')}
            </SelectItem>
            <SelectItem value="20" label={t('۲۰ در صفحه')}>
              {t('۲۰ در صفحه')}
            </SelectItem>
            <SelectItem value="50" label={t('۵۰ در صفحه')}>
              {t('۵۰ در صفحه')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          className="h-11 gap-2 sm:h-9"
          disabled={!hasActiveFilters}
          onClick={resetFilters}
        >
          <RotateCcwIcon aria-hidden="true" />
          {t('بازنشانی فیلترها')}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {listQuery.isFetching && !listQuery.isLoading
            ? t('در حال به‌روزرسانی…')
            : total === 0
              ? t('نتیجه‌ای نیست')
              : t('{0} کاربر', { '0': total.toLocaleString(numberLocale) })}
        </span>
        {pageCount > 1 ? (
          <span>
            {t('صفحه')} {currentPage.toLocaleString(numberLocale)} {t('از')}{' '}
            {pageCount.toLocaleString(numberLocale)}
          </span>
        ) : null}
      </div>

      {listQuery.data?.syncFailed ? (
        <p role="status" className="text-sm text-amber-600">
          {t(
            'ارتباط با Marzban برای بعضی کاربران برقرار نشد؛ اطلاعات ذخیره‌شده نمایش داده می‌شود.',
          )}
        </p>
      ) : null}

      {listQuery.error ? (
        <QueryErrorState
          error={listQuery.error}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      <VpnUsersList
        users={users}
        loading={listQuery.isLoading}
        busy={actionMutation.isPending}
        allowArchive={isAdmin}
        onManage={setManageUser}
        onContact={(user) => setContactUser(user)}
        onAction={async (type, user) => {
          await actionMutation.mutateAsync({
            type,
            username: user.marzbanUsername,
          })
        }}
      />

      {pageCount > 1 ? (
        <UsersPagination
          page={currentPage}
          pageCount={pageCount}
          disabled={listQuery.isFetching}
          onPageChange={(next) => setSearchParams({ page: next })}
        />
      ) : null}

      <CreateVpnUserDialog
        open={open}
        onOpenChange={setOpen}
        isAdmin={isAdmin}
        resellers={(resellersQuery.data ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          usernameSuffix: r.usernameSuffix ?? '',
          pricePerGbToman: r.pricePerGbToman ?? 0,
          allowUnlimitedExpire: Boolean(r.allowUnlimitedExpire),
        }))}
        ownProfile={
          meQuery.data?.profile
            ? {
                usernameSuffix: meQuery.data.profile.usernameSuffix,
                pricePerGbToman: meQuery.data.profile.pricePerGbToman,
                allowUnlimitedExpire: Boolean(
                  meQuery.data.profile.allowUnlimitedExpire,
                ),
              }
            : null
        }
        onCreated={() => void invalidate()}
      />

      <ContactDialog
        target={contactUser}
        onOpenChange={(next) => {
          if (!next) setContactUser(null)
        }}
        onSaved={() => void invalidate()}
      />

      <ManageVpnUserSheet
        user={manageUser}
        open={manageUser != null}
        onOpenChange={(next) => {
          if (!next) setManageUser(null)
        }}
        pricePerGbToman={managePrice}
        allowUnlimitedExpire={
          isAdmin
            ? Boolean(
                (resellersQuery.data ?? []).find(
                  (r) => r.id === manageUser?.resellerId,
                )?.allowUnlimitedExpire,
              )
            : Boolean(meQuery.data?.profile?.allowUnlimitedExpire)
        }
        onSuccess={() => void invalidate()}
      />
    </div>
  )
}

function UsersPagination({
  page,
  pageCount,
  disabled,
  onPageChange,
}: {
  page: number
  pageCount: number
  disabled?: boolean
  onPageChange: (page: number) => void
}) {
  const { t, numberLocale } = useI18n()

  const items = useMemo(
    () => buildPageItems(page, pageCount),
    [page, pageCount],
  )

  return (
    <Pagination className="justify-center sm:justify-end">
      <PaginationContent>
        <PaginationItem>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('قبلی')}
          </Button>
        </PaginationItem>
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            <PaginationItem key={`e-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={item}>
              <Button
                variant={item === page ? 'outline' : 'ghost'}
                size="icon-sm"
                disabled={disabled}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => onPageChange(item)}
              >
                {item.toLocaleString(numberLocale)}
              </Button>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            {t('بعدی')}
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

function buildPageItems(page: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1) as Array<
      number | 'ellipsis'
    >
  }

  const items: Array<number | 'ellipsis'> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pageCount - 1, page + 1)

  if (start > 2) items.push('ellipsis')
  for (let i = start; i <= end; i += 1) items.push(i)
  if (end < pageCount - 1) items.push('ellipsis')
  items.push(pageCount)
  return items
}
