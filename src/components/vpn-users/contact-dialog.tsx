import { useI18n } from '#/components/locale-provider'
import { useMutation } from '@tanstack/react-query'
import { CopyIcon } from 'lucide-react'
import { useState } from 'react'

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

export type ContactTarget = {
  marzbanUsername: string
  contactPhone?: string | null
  contactTelegram?: string | null
  labels?: string[]
}

/** Edit a customer's phone, Telegram handle and labels (comma-separated). */
export function ContactDialog({
  target,
  onOpenChange,
  onSaved,
}: {
  target: ContactTarget | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ContactForm
            key={target.marzbanUsername}
            target={target}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ContactForm({
  target,
  onClose,
  onSaved,
}: {
  target: ContactTarget
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()

  const [phone, setPhone] = useState(target.contactPhone ?? '')
  const [telegram, setTelegram] = useState(target.contactTelegram ?? '')
  const [labels, setLabels] = useState((target.labels ?? []).join(', '))

  const save = useMutation({
    mutationFn: () =>
      orpc.tools.updateContact.call({
        username: target.marzbanUsername,
        phone: phone.trim() || null,
        telegram: telegram.trim() || null,
        labels: labels
          .split(/[,،]/)
          .map((l) => l.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toastSuccess(t('اطلاعات مشتری ذخیره شد'))
      onSaved()
      onClose()
    },
    onError: (err) => toastError(t('ذخیره انجام نشد'), err),
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('اطلاعات مشتری')}</DialogTitle>
        <DialogDescription dir="ltr" className="text-start font-mono">
          {target.marzbanUsername}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="c-phone">{t('شماره تماس')}</Label>
          <Input
            id="c-phone"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-tg">{t('تلگرام')}</Label>
          <Input
            id="c-tg"
            dir="ltr"
            placeholder="username"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-labels">{t('برچسب‌ها (با کاما جدا کنید)')}</Label>
          <Input
            id="c-labels"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder={t('vip, دوست')}
          />
        </div>
      </div>
      <CustomerLink username={target.marzbanUsername} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('انصراف')}
        </Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {t('ذخیره')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** The link is shown once (only its hash is stored); generating another replaces it. */
function CustomerLink({ username }: { username: string }) {
  const { t } = useI18n()

  const [url, setUrl] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => orpc.customers.createLink.call({ username }),
    onSuccess: (r) => setUrl(r.url),
    onError: (err) => toastError(t('ساخت لینک انجام نشد'), err),
  })
  const revoke = useMutation({
    mutationFn: () => orpc.customers.revokeLink.call({ username }),
    onSuccess: () => {
      setUrl(null)
      toastSuccess(t('لینک لغو شد'))
    },
    onError: (err) => toastError(t('لغو لینک انجام نشد'), err),
  })

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-medium">{t('صفحه اختصاصی مشتری')}</p>
      <p className="text-xs text-muted-foreground">
        {t(
          'مشتری با این لینک مصرف، اعتبار و کد اتصال را می‌بیند و می‌تواند درخواست تمدید بدهد. ساخت لینک جدید، لینک قبلی را باطل می‌کند.',
        )}
      </p>
      {url ? (
        <div className="flex gap-2">
          <Input
            readOnly
            dir="ltr"
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('لینک مشتری')}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label={t('کپی')}
            onClick={() =>
              void navigator.clipboard
                .writeText(url)
                .then(() => toastSuccess(t('کپی شد')))
            }
          >
            <CopyIcon />
          </Button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {url ? t('ساخت لینک جدید') : t('ساخت لینک')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          {t('لغو لینک')}
        </Button>
      </div>
    </div>
  )
}
