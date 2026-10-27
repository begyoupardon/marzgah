import { useI18n } from '#/components/locale-provider'
import type { ReactNode } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { useIsMobile } from '#/hooks/use-mobile'
import { cn } from 'cn'

type ResponsiveFormShellProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer: ReactNode
  className?: string
}

/**
 * Mobile: bottom sheet with sticky header/footer and scrollable body.
 * Desktop: centered dialog with the same scroll contract.
 */
export function ResponsiveFormShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: ResponsiveFormShellProps) {
  const { t } = useI18n()

  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn(
            'flex h-auto max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0',
            'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            className,
          )}
        >
          <div
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30"
            aria-hidden
          />
          <SheetHeader className="shrink-0 gap-1 border-b px-4 py-3 text-start">
            <SheetTitle>{t(title)}</SheetTitle>
            {description ? (
              <SheetDescription>{t(description)}</SheetDescription>
            ) : null}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch]">
            {children}
          </div>
          <div className="shrink-0 border-t bg-muted/40 px-4 py-3">
            {footer}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[min(92dvh,40rem)] w-full max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md',
          className,
        )}
      >
        <DialogHeader className="shrink-0 gap-1 border-b px-4 py-4 pe-12 text-start">
          <DialogTitle>{t(title)}</DialogTitle>
          {description ? (
            <DialogDescription>{t(description)}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>
        <div className="shrink-0 border-t bg-muted/40 px-4 py-3">{footer}</div>
      </DialogContent>
    </Dialog>
  )
}
