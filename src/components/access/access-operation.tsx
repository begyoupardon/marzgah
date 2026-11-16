import { accessMessage } from '#/lib/access-messages'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useI18n } from '#/components/locale-provider'
import { Button } from '#/components/ui/button'
import { orpc } from '#/orpc/client'
import { getErrorMessage } from '#/lib/errors'

export function AccessOperationPanel({
  id,
  admin = false,
}: {
  id: string
  admin?: boolean
}) {
  const { t } = useI18n()
  const [offset, setOffset] = useState(0)
  const query = useQuery({
    ...orpc.access.operation.queryOptions({ input: { id, offset, limit: 50 } }),
    refetchInterval: (q) => (q.state.data?.pending ? 2000 : false),
  })
  const retry = useMutation({
    ...orpc.access.retry.mutationOptions(),
    onSuccess: () => {
      void query.refetch()
    },
  })
  const drain = useMutation({
    ...orpc.access.drain.mutationOptions(),
    onSuccess: () => {
      void query.refetch()
    },
  })
  const error = query.error ?? retry.error ?? drain.error
  return (
    <section
      className="space-y-3 rounded-xl border p-3"
      aria-label={t('وضعیت اعمال دسترسی')}
    >
      <p className="text-sm font-semibold">{t('وضعیت اعمال دسترسی')}</p>
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {accessMessage(getErrorMessage(error), t)}
        </p>
      )}
      {query.data && (
        <>
          <p role="status" aria-live="polite" className="text-sm">
            {t('اعمال‌شده: {0} · در انتظار: {1} · ناموفق: {2}', {
              0: query.data.applied,
              1: query.data.pending,
              2: query.data.failed,
            })}
          </p>
          {query.data.pending > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(
                'اعمال تغییرات در پس‌زمینه ادامه دارد. می‌توانید این صفحه را ببندید.',
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {query.data.failed > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ id })}
              >
                {t('تلاش مجدد موارد ناموفق')}
              </Button>
            )}
            {admin && query.data.pending > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={drain.isPending}
                onClick={() => drain.mutate({ limit: 20 })}
              >
                {t('پردازش یک دسته')}
              </Button>
            )}
          </div>
          <details>
            <summary className="cursor-pointer text-sm">
              {t('جزئیات کاربران')}
            </summary>
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs">
              {query.data.tasks.map((task) => (
                <li key={task.id} className="break-words">
                  <b dir="auto">{task.username}</b> ·{' '}
                  {accessMessage(task.status, t)}{' '}
                  {task.error && (
                    <span className="text-destructive">
                      {accessMessage(task.error, t)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              {offset > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  {t('قبلی')}
                </Button>
              )}
              {query.data.hasMore && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOffset(offset + 50)}
                >
                  {t('بعدی')}
                </Button>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  )
}
