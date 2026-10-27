import { createFileRoute } from '@tanstack/react-router'
import { handleWebhook } from '#/lib/marzban/webhook-handler'

export const Route = createFileRoute('/api/webhooks/marzban')({
  server: { handlers: { POST: handleWebhook } },
})
