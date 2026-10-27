import { useI18n } from '#/components/locale-provider'
import { AlertCircleIcon, RotateCcwIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { getErrorMessage } from '#/lib/errors'
import { cn } from 'cn'

type QueryErrorStateProps = {
  error: unknown
  onRetry?: () => void
  title?: string
  className?: string
  compact?: boolean
}

export function QueryErrorState({
  error,
  onRetry,
  title = 'بارگذاری انجام نشد',
  className,
  compact = false,
}: QueryErrorStateProps) {
  const { t } = useI18n()

  const message = t(getErrorMessage(error))

  if (compact) {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-wrap items-center gap-2 text-sm text-destructive',
          className,
        )}
      >
        <AlertCircleIcon className="size-4 shrink-0" />
        <span>{t(message)}</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            {t('تلاش دوباره')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-destructive">{t(title)}</p>
          <p className="text-sm text-muted-foreground">{t(message)}</p>
        </div>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="ms-8"
        >
          <RotateCcwIcon data-icon="inline-start" />
          {t('تلاش دوباره')}
        </Button>
      ) : null}
    </div>
  )
}
