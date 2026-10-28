import '#/polyfill'

import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { createFileRoute } from '@tanstack/react-router'
import { clientIp } from '#/lib/rate-limit'
import { logServerError } from '#/lib/server-errors'
import router from '#/orpc/router'

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error, options) => {
      const url = options.request ? new URL(options.request.url) : null
      logServerError(error, 'rpc', {
        method: options.request?.method,
        path: url?.pathname,
        ip: options.context?.headers
          ? clientIp(options.context.headers)
          : undefined,
      })
    }),
  ],
})

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: {
      headers: request.headers,
    },
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
})
