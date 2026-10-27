import { toast } from '#/components/ui/toast'
import { getErrorMessage } from '#/lib/errors'

export function toastError(title: string, error?: unknown) {
  toast.add({
    type: 'error',
    title,
    description: error != null ? getErrorMessage(error) : undefined,
  })
}

export function toastSuccess(title: string, description?: string) {
  toast.add({
    type: 'success',
    title,
    description,
  })
}
