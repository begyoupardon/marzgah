import { createFileRoute } from '@tanstack/react-router'
import { serveManagedSubscription } from '#/lib/managed-subscription'
export const Route = createFileRoute('/subscription/$id/$token')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        serveManagedSubscription(request, params.id, params.token),
    },
  },
})
