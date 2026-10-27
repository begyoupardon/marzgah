import { createFileRoute } from '@tanstack/react-router'

import { handleTelegramUpdate } from '#/lib/notifications/telegram'

export const Route = createFileRoute('/api/telegram/webhook')({
  server: {
    handlers: { POST: ({ request }) => handleTelegramUpdate(request) },
  },
})
