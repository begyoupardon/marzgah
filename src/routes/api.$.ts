import '#/polyfill'

import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { createFileRoute } from '@tanstack/react-router'
import { onError } from '@orpc/server'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'

import { clientIp } from '#/lib/rate-limit'
import { logServerError } from '#/lib/server-errors'
import { VpnUserStatusSchema } from '#/orpc/schema'
import router from '#/orpc/router'

const handler = new OpenAPIHandler(router, {
  interceptors: [
    onError((error, options) => {
      const url = options.request ? new URL(options.request.url) : null
      logServerError(error, 'openapi', {
        method: options.request?.method,
        path: url?.pathname,
        ip: options.context?.headers
          ? clientIp(options.context.headers)
          : undefined,
      })
    }),
  ],
  plugins: [
    new SmartCoercionPlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specGenerateOptions: {
        info: {
          title: 'Marzgah API',
          version: '1.0.0',
        },
        commonSchemas: {
          VpnUserStatus: { schema: VpnUserStatusSchema },
          UndefinedError: { error: 'UndefinedError' },
        },
        security: [{ cookieAuth: [] }],
        components: {
          securitySchemes: {
            cookieAuth: {
              type: 'apiKey',
              in: 'cookie',
              name: 'better-auth.session_token',
            },
          },
        },
      },
    }),
  ],
})

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: '/api',
    context: {
      headers: request.headers,
    },
  })

  return response ?? new Response('Not Found', { status: 404 })
}

export const Route = createFileRoute('/api/$')({
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
