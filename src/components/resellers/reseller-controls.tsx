import { useI18n } from '#/components/locale-provider'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { toastError, toastSuccess } from '#/lib/toast'
import { orpc } from '#/orpc/client'

const num = (v: string) =>
  v.trim() === '' ? null : Number(v.replace(/[^\d]/g, ''))

/** Per-seller caps plus suspend / resume (disables or restores all their users). */
export function ResellerControls() {
  const { t, numberLocale } = useI18n()

  const queryClient = useQueryClient()
  const resellers = useQuery(orpc.admin.listResellers.queryOptions())
  const [resellerId, setResellerId] = useState('')
  const [maxUsers, setMaxUsers] = useState<string | null>(null)
  const [maxGb, setMaxGb] = useState<string | null>(null)
  const current = resellers.data?.find((r) => r.id === resellerId)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.admin.listResellers.key() })

  const saveLimits = useMutation({
    mutationFn: () =>
      orpc.tools.setResellerLimits.call({
        resellerId,
        maxUsers: num(maxUsers ?? String(current?.maxUsers ?? '')),
        maxTotalGb: num(maxGb ?? String(current?.maxTotalGb ?? '')),
      }),
    onSuccess: async () => {
      await refresh()
      setMaxUsers(null)
      setMaxGb(null)
      toastSuccess(t('سقف‌ها ذخیره شد'))
    },
    onError: (err) => toastError(t('ذخیره سقف‌ها انجام نشد'), err),
  })

  const toggle = useMutation({
    mutationFn: (suspend: boolean) =>
      suspend
        ? orpc.tools.suspendReseller.call({ resellerId })
        : orpc.tools.resumeReseller.call({ resellerId }),
    onSuccess: async (result, suspend) => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: orpc.vpnUsers.list.key() }),
      ])
      if (result.failed.length > 0) {
        toastError(
          t('{0} کاربر تغییر کرد، {1} ناموفق', {
            '0': result.changed.toLocaleString(numberLocale),
            '1': result.failed.length.toLocaleString(numberLocale),
          }),
          new Error(t('دوباره تلاش کنید؛ فقط کاربران باقی‌مانده پردازش می‌شوند')),
        )
      } else {
        toastSuccess(
          suspend ? t('نماینده تعلیق شد') : t('نماینده فعال شد'),
          t('{0} کاربر', { '0': result.changed.toLocaleString(numberLocale) }),
        )
      }
    },
    onError: (err) => toastError(t('عملیات انجام نشد'), err),
  })

  const suspended = current?.status === 'disabled'

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t('سقف‌ها و تعلیق')}</CardTitle>
        <CardDescription>
          {t('محدودیت تعداد و حجم کل، یا تعلیق موقت نماینده با همه کاربرانش')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <Select
          items={(resellers.data ?? []).map((r) => ({
            value: r.id,
            label: r.name,
          }))}
          value={resellerId || null}
          onValueChange={(v) => {
            setResellerId(v ?? '')
            setMaxUsers(null)
            setMaxGb(null)
          }}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder={t('انتخاب نماینده')} />
          </SelectTrigger>
          <SelectContent>
            {(resellers.data ?? []).map((r) => (
              <SelectItem
                key={r.id}
                value={r.id}
                label={r.name}
                description={r.email}
              >
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {current ? (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="max-users">
                    {t('حداکثر کاربر (خالی = نامحدود)')}
                  </Label>
                  <Input
                    id="max-users"
                    dir="ltr"
                    inputMode="numeric"
                    value={maxUsers ?? String(current.maxUsers ?? '')}
                    onChange={(e) => setMaxUsers(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-gb">{t('حداکثر حجم کل (گیگ)')}</Label>
                  <Input
                    id="max-gb"
                    dir="ltr"
                    inputMode="numeric"
                    value={maxGb ?? String(current.maxTotalGb ?? '')}
                    onChange={(e) => setMaxGb(e.target.value)}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                disabled={saveLimits.isPending}
                onClick={() => saveLimits.mutate()}
              >
                {t('ذخیره سقف‌ها')}
              </Button>
            </div>
            <div className="space-y-3">
              <Badge variant={suspended ? 'destructive' : 'outline'}>
                {suspended ? t('تعلیق / غیرفعال') : t('فعال')}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {t(
                  'تعلیق، همه کاربران فعال این نماینده را غیرفعال می‌کند. با فعال‌سازی دوباره، فقط همان کاربران برمی‌گردند؛ کاربرانی که خودش غیرفعال کرده بود دست نمی‌خورند.',
                )}
              </p>
              <Button
                variant={suspended ? 'default' : 'destructive'}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(!suspended)}
              >
                {suspended ? t('فعال‌سازی نماینده') : t('تعلیق نماینده')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
