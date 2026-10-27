import { useI18n } from '#/components/locale-provider'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'

export function StatCard({
  title,
  value,
  hint,
  icon,
  tone,
  loading,
}: {
  title: string
  value: string
  hint?: string
  icon: ReactNode
  tone?: 'danger' | 'good'
  loading?: boolean
}) {
  const { t } = useI18n()

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardDescription className="flex items-center justify-between gap-2">
          {t(title)}
          {icon}
        </CardDescription>
        {loading ? (
          <Skeleton className="h-7 w-32" />
        ) : (
          <CardTitle
            className={cn(
              'text-xl',
              tone === 'danger' && 'text-destructive',
              tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {value}
          </CardTitle>
        )}
        {hint ? <CardDescription>{t(hint)}</CardDescription> : null}
      </CardHeader>
    </Card>
  )
}
