import { expect, it } from 'bun:test'
import { getErrorMessage, isNonRetryableError } from './errors'

it.each([
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_EMAIL',
  'PASSWORD_TOO_LONG',
  'FAILED_TO_CREATE_SESSION',
  'INVALID_ORIGIN',
])('shows a specific Persian login error for %s', (code) => {
  expect(getErrorMessage({ code, message: 'English error' })).not.toBe(
    'خطایی رخ داد. لطفاً دوباره تلاش کنید',
  )
})
it('preserves server-provided Persian messages', () => {
  expect(getErrorMessage(new Error('حساب غیرفعال است'))).toBe(
    'حساب غیرفعال است',
  )
})
it('does not retry authorization failures', () => {
  expect(isNonRetryableError({ code: 'FORBIDDEN' })).toBe(true)
  expect(isNonRetryableError({ code: 'INTERNAL_SERVER_ERROR' })).toBe(false)
})
