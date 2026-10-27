import { QueryClient } from '@tanstack/react-query'

import {
  isNonRetryableError,
  redirectToLoginIfUnauthorized,
} from '#/lib/errors'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (isNonRetryableError(error)) return false
          return failureCount < 2
        },
        throwOnError: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.query.state.status === 'error') {
      redirectToLoginIfUnauthorized(event.query.state.error)
    }
  })

  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.mutation.state.status === 'error') {
      redirectToLoginIfUnauthorized(event.mutation.state.error)
    }
  })

  return {
    queryClient,
  }
}

export default function TanstackQueryProvider() {}
