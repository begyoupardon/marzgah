import { useI18n } from '#/components/locale-provider'
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { CopyIcon, DownloadIcon, Share2Icon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/toast'

export type SubscriptionShareTarget = {
  username: string
  subscriptionUrl: string
}

export function SubscriptionShareDialog({
  target,
  open,
  onOpenChange,
}: {
  target: SubscriptionShareTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [canNativeShare, setCanNativeShare] = useState(false)
  const url = target?.subscriptionUrl ?? ''
  const username = target?.username ?? ''

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  const shareCaption = useMemo(() => {
    return [t('کاربر: {0}', { '0': username })].filter(Boolean).join('\n')
  }, [username])

  const shareTextWithLink = useMemo(() => {
    if (!url) return shareCaption
    return `${shareCaption}\n${url}`
  }, [shareCaption, url])

  useEffect(() => {
    if (!open || !url) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(url, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
    }).then(
      (dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl)
      },
      () => {
        if (!cancelled) {
          setQrDataUrl(null)
          toast.add({ type: 'error', title: t('ساخت QR انجام نشد') })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, url])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast.add({ type: 'success', title: t('لینک اشتراک کپی شد') })
    } catch {
      toast.add({ type: 'error', title: t('کپی لینک انجام نشد') })
    }
  }

  function downloadQr() {
    if (!qrDataUrl) return
    const anchor = document.createElement('a')
    anchor.href = qrDataUrl
    anchor.download = `${username || 'subscription'}.png`
    anchor.click()
  }

  async function shareNative() {
    if (!qrDataUrl || !navigator.share) {
      toast.add({
        type: 'error',
        title: t('اشتراک‌گذاری پشتیبانی نمی‌شود'),
      })
      return
    }

    try {
      const response = await fetch(qrDataUrl)
      const blob = await response.blob()
      const file = new File([blob], `${username || 'subscription'}.png`, {
        type: 'image/png',
      })
      // Image + link in text together. Do not also pass ShareData.url —
      // that creates a second link-preview image.
      const withFiles: ShareData = {
        title: 'Subscription',
        text: shareTextWithLink,
        files: [file],
      }
      if (navigator.canShare?.(withFiles)) {
        await navigator.share(withFiles)
        return
      }
      await navigator.share({ title: 'Marzgah', text: shareTextWithLink })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.add({ type: 'error', title: t('اشتراک‌گذاری انجام نشد') })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,36rem)] w-full max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 gap-1 border-b px-4 py-4 pe-12 text-start">
          <DialogTitle>{t('اشتراک و QR')}</DialogTitle>
          <DialogDescription>
            {t('لینک و کد QR را کپی کنید یا در تلگرام و واتساپ بفرستید')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border bg-white p-3">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Subscription QR"
                  className="size-44 sm:size-52"
                  width={208}
                  height={208}
                />
              ) : (
                <div className="flex size-44 items-center justify-center text-sm text-muted-foreground sm:size-52">
                  {t('در حال ساخت QR…')}
                </div>
              )}
            </div>

            <div className="w-full space-y-1.5">
              <p className="text-xs text-muted-foreground">{t('کاربر')}</p>
              <p className="truncate font-mono text-sm font-medium" dir="ltr">
                {username}
              </p>
            </div>

            <div className="w-full space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {t('لینک اشتراک')}
              </p>
              <p
                className="break-all rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs"
                dir="ltr"
              >
                {url}
              </p>
            </div>

            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-8"
                onClick={() => void copyLink()}
              >
                <CopyIcon className="size-4" />
                {t('کپی لینک')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-8"
                disabled={!qrDataUrl}
                onClick={downloadQr}
              >
                <DownloadIcon className="size-4" />
                {t('دانلود QR')}
              </Button>
            </div>

            {canNativeShare ? (
              <Button
                type="button"
                className="h-11 w-full sm:h-8"
                disabled={!qrDataUrl}
                onClick={() => void shareNative()}
              >
                <Share2Icon className="size-4" />
                {t('اشتراک QR + لینک')}
              </Button>
            ) : null}

            <p className="text-center text-xs text-muted-foreground">
              {t(
                'اشتراک، تصویر QR و لینک اشتراک را با هم می‌فرستد. در موبایل تلگرام یا واتساپ را از لیست انتخاب کنید.',
              )}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
