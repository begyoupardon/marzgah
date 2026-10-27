import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { LOCALE_COOKIE, normalizeLocale } from './core'

// Resolve each request independently: never share a mutable locale between users.
export const getRequestLocale = createServerFn({ method: 'GET' }).handler(() =>
  normalizeLocale(getCookie(LOCALE_COOKIE)),
)
