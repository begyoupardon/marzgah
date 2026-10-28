import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { RouteError } from '#/components/route-error'
import { deLocalizeUrl, localizeUrl } from '#/lib/i18n/core'
import { getActiveLocale } from '#/lib/i18n/routing'
import { getContext } from './integrations/tanstack-query/root-provider'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url, getActiveLocale()),
    },
    defaultErrorComponent: ({ error, reset }) => (
      <RouteError error={error} reset={reset} />
    ),
    defaultNotFoundComponent: () => (
      <RouteError error={new Error('صفحه مورد نظر پیدا نشد')} />
    ),
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
