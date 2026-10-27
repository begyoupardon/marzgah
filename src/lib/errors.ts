import { ORPCError } from '@orpc/client'

/** Persian fallbacks when the server message is missing or English boilerplate. */
const CODE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'ایمیل یا رمز عبور اشتباه است',
  INVALID_EMAIL: 'ایمیل نامعتبر است',
  PASSWORD_TOO_LONG: 'رمز عبور بیش از حد طولانی است',
  FAILED_TO_CREATE_SESSION: 'ایجاد نشست ورود انجام نشد؛ دوباره تلاش کنید',
  INVALID_ORIGIN: 'آدرس سایت برای ورود مجاز نیست',
  BAD_REQUEST: 'درخواست نامعتبر است',
  UNAUTHORIZED: 'نشست شما منقضی شده است. دوباره وارد شوید',
  FORBIDDEN: 'دسترسی به این بخش مجاز نیست',
  NOT_FOUND: 'مورد درخواستی پیدا نشد',
  CONFLICT: 'این مورد قبلاً ثبت شده است',
  INTERNAL_SERVER_ERROR: 'خطای داخلی سرور رخ داد',
  TIMEOUT: 'زمان درخواست تمام شد',
  TOO_MANY_REQUESTS: 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید',
  SERVICE_UNAVAILABLE: 'سرویس موقتاً در دسترس نیست',
}

/** Known English / mixed server strings → Persian. */
const KNOWN_MESSAGES: Record<string, string> = {
  'Admin only': 'فقط مدیر سامانه به این بخش دسترسی دارد',
  'VPN user not found': 'کاربر VPN پیدا نشد',
  'Reseller not found': 'نماینده پیدا نشد',
  'resellerId is required for admin': 'انتخاب نماینده برای مدیر الزامی است',
  'Failed to create reseller': 'ایجاد نماینده انجام نشد',
  Unauthorized: 'نشست شما منقضی شده است. دوباره وارد شوید',
  Forbidden: 'دسترسی به این بخش مجاز نیست',
  'Not Found': 'مورد درخواستی پیدا نشد',
  'Bad Request': 'درخواست نامعتبر است',
  Conflict: 'این مورد قبلاً ثبت شده است',
  'Internal Server Error': 'خطای داخلی سرور رخ داد',
}

const DEFAULT_MESSAGE = 'خطایی رخ داد. لطفاً دوباره تلاش کنید'

function hasPersian(text: string) {
  return /[\u0600-\u06FF]/.test(text)
}

function looksLikeEnglishBoilerplate(message: string, code?: string) {
  if (!message.trim()) return true
  if (hasPersian(message)) return false
  if (code && CODE_MESSAGES[code] && message === code.replaceAll('_', ' ')) {
    return true
  }
  // ORPC default messages match COMMON_ORPC_ERROR_DEFS English titles
  return /^(Unauthorized|Forbidden|Not Found|Bad Request|Conflict|Internal Server Error|Too Many Requests|Service Unavailable|Gateway Timeout|Timeout)$/i.test(
    message,
  )
}

export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof ORPCError) return error.code
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return (error as { code: string }).code
  }
  return undefined
}

export function isUnauthorizedError(error: unknown) {
  return getErrorCode(error) === 'UNAUTHORIZED'
}

export function isForbiddenError(error: unknown) {
  return getErrorCode(error) === 'FORBIDDEN'
}

export function isConflictError(error: unknown) {
  return getErrorCode(error) === 'CONFLICT'
}

export function isNotFoundError(error: unknown) {
  return getErrorCode(error) === 'NOT_FOUND'
}

/** Client / validation errors that should not be retried. */
export function isNonRetryableError(error: unknown) {
  const code = getErrorCode(error)
  if (!code) return false
  return [
    'BAD_REQUEST',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
    'PAYLOAD_TOO_LARGE',
    'METHOD_NOT_SUPPORTED',
    'NOT_ACCEPTABLE',
  ].includes(code)
}

export function getErrorMessage(
  error: unknown,
  fallback = DEFAULT_MESSAGE,
): string {
  if (error == null) return fallback

  if (typeof error === 'string') {
    return KNOWN_MESSAGES[error] ?? (hasPersian(error) ? error : fallback)
  }

  const code = getErrorCode(error)
  const raw =
    error instanceof Error
      ? error.message
      : error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string'
        ? (error as { message: string }).message
        : ''

  if (raw) {
    if (KNOWN_MESSAGES[raw]) return KNOWN_MESSAGES[raw]
    if (hasPersian(raw)) return raw
    if (!looksLikeEnglishBoilerplate(raw, code)) {
      // Prefer Persian code fallback over opaque English internals
      if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
      return fallback
    }
  }

  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  return fallback
}

export function redirectToLoginIfUnauthorized(error: unknown) {
  if (!isUnauthorizedError(error)) return false
  if (typeof window === 'undefined') return false
  const next = `${window.location.pathname}${window.location.search}`
  const params = new URLSearchParams()
  if (next && next !== '/login') params.set('redirect', next)
  const qs = params.toString()
  window.location.assign(qs ? `/login?${qs}` : '/login')
  return true
}
