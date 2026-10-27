import { useI18n } from '#/components/locale-provider'
import { useRouter } from '@tanstack/react-router'
import { AlertCircleIcon, HomeIcon, RotateCcwIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { getErrorMessage } from '#/lib/errors'

type RouteErrorProps = {
  error: unknown
  reset?: () => void
}

export function RouteError({ error, reset }: RouteErrorProps) {
  const { t } = useI18n()

  const router = useRouter()
  const message = t(getErrorMessage(error))

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircleIcon className="size-6" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('مشکلی پیش آمد')}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">{t(message)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={() => {
            reset?.()
            void router.invalidate()
          }}
        >
          <RotateCcwIcon data-icon="inline-start" />
          {t('تلاش دوباره')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void router.navigate({ to: '/dashboard' })}
        >
          <HomeIcon data-icon="inline-start" />
          {t('داشبورد')}
        </Button>
      </div>
    </div>
  )
}
