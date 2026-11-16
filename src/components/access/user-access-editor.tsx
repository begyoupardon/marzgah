import { accessMessage } from '#/lib/access-messages'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useI18n } from '#/components/locale-provider'
import { Button } from '#/components/ui/button'
import { getErrorMessage } from '#/lib/errors'
import { orpc } from '#/orpc/client'
import type { AccessSelection } from '#/lib/access-policy'
import { AccessSelectionField } from './access-selection'
import { AccessOperationPanel } from './access-operation'

export function UserAccessEditor({
  username,
  resellerId,
}: {
  username: string
  resellerId?: string
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const query = useQuery({
    ...orpc.access.user.queryOptions({ input: { username } }),
    refetchOnWindowFocus: false,
  })
  const [selection, setSelection] = useState<AccessSelection>()
  const [operationId, setOperationId] = useState<string>()
  const [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => {
    if (query.data && !selection)
      setSelection(
        query.data.selection.mode === 'custom'
          ? { mode: 'custom', inbounds: query.data.base }
          : query.data.selection,
      )
  }, [query.data, selection])
  const save = useMutation({
    ...orpc.access.assign.mutationOptions(),
    onSuccess: (result) => {
      setOperationId(result.operationId)
      setKey(crypto.randomUUID())
      void query.refetch()
    },
  })
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{t('دسترسی اتصال')}</h3>
      {query.isPending && <p role="status">{t('در حال دریافت اینباندها…')}</p>}
      {(query.error || save.error) && (
        <p role="alert" className="text-sm text-destructive">
          {accessMessage(getErrorMessage(query.error ?? save.error), t)}
        </p>
      )}
      {(query.error || save.error) && (
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await query.refetch()
            await queryClient.invalidateQueries({
              queryKey: orpc.access.catalog.key(),
            })
            setKey(crypto.randomUUID())
            save.reset()
          }}
        >
          {t('تلاش مجدد')}
        </Button>
      )}
      {query.data && selection && (
        <>
          {query.data.error && (
            <p role="alert" className="text-sm text-destructive">
              {accessMessage(query.data.error, t)}
            </p>
          )}
          <AccessSelectionField
            value={selection}
            onChange={(next) => {
              setSelection(next)
              setKey(crypto.randomUUID())
              save.reset()
            }}
            resellerId={resellerId}
            backend={query.data.backend}
            locked={query.data.locked}
            fallbackInbounds={query.data.base}
            templateName={query.data.templateName}
            allowDefault={false}
            disabled={save.isPending}
          />
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                username,
                selection,
                revision: query.data!.revision,
                policyRevision: query.data!.policyRevision,
                idempotencyKey: key,
              })
            }
          >
            {t('ذخیره دسترسی اتصال')}
          </Button>
        </>
      )}
      {operationId && <AccessOperationPanel id={operationId} />}
    </section>
  )
}
