import * as z from 'zod'

/** Reseller tag prepended to VPN usernames: `{suffix}_{local}` → example_name1 */
export const USERNAME_SUFFIX_REGEX = /^[a-zA-Z][a-zA-Z0-9]{1,15}$/

export const usernameSuffixSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'پسوند حداقل ۲ کاراکتر باشد')
  .max(16, 'پسوند حداکثر ۱۶ کاراکتر باشد')
  .regex(
    USERNAME_SUFFIX_REGEX,
    'پسوند باید با حرف انگلیسی شروع شود و فقط حروف و عدد داشته باشد',
  )

export const LOCAL_USERNAME_REGEX = /^[a-zA-Z0-9-_@.]+$/

export const localUsernameSchema = z
  .string()
  .trim()
  .min(1, 'نام کاربری الزامی است')
  .max(24, 'نام کاربری حداکثر ۲۴ کاراکتر باشد')
  .regex(LOCAL_USERNAME_REGEX, 'فقط حروف انگلیسی، عدد و - _ @ . مجاز است')

export function buildVpnUsername(suffix: string, localUsername: string) {
  const cleanSuffix = suffix.trim().toLowerCase()
  const cleanLocal = localUsername.trim()
  return `${cleanSuffix}_${cleanLocal}`
}

export function assertValidFullVpnUsername(fullUsername: string) {
  if (fullUsername.length < 3 || fullUsername.length > 32) {
    throw new Error('نام کاربری نهایی باید بین ۳ تا ۳۲ کاراکتر باشد')
  }
  if (!/^[a-zA-Z0-9-_@.]+$/.test(fullUsername)) {
    throw new Error('نام کاربری نهایی نامعتبر است')
  }
}
