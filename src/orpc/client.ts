import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createRouterClient } from '@orpc/server'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { createIsomorphicFn } from '@tanstack/react-start'

import type { RouterClient } from '@orpc/server'
import type { RouterUtils } from '@orpc/tanstack-query'

import { router } from '#/orpc/router'

export type AppRouter = typeof router
export type AppRouterClient = RouterClient<AppRouter>

const getORPCClient = createIsomorphicFn()
  .server((): AppRouterClient =>
    createRouterClient(router, {
      context: async () => {
        const { getRequestHeaders } =
          await import('@tanstack/react-start/server')
        return {
          headers: getRequestHeaders(),
        }
      },
    }),
  )
  .client((): AppRouterClient => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
      fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
    })

    return createORPCClient(link)
  })

export const client: AppRouterClient = getORPCClient()

export const orpc: RouterUtils<AppRouterClient> =
  createTanstackQueryUtils(client)
