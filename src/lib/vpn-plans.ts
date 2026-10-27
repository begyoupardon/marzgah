import * as z from 'zod'

import { localUsernameSchema } from '#/lib/reseller-naming'

export const BYTES_PER_GB = 1024 ** 3

/** Data limit must be at least 10 GB. */
export const MIN_DATA_LIMIT_GB = 10
export const MIN_DATA_LIMIT_BYTES = MIN_DATA_LIMIT_GB * BYTES_PER_GB

export const DATA_PRESETS_GB = [25, 50, 100] as const

export const DURATION_MONTHS = [1, 2, 3] as const
export type DurationMonths = (typeof DURATION_MONTHS)[number]

/** `0` means unlimited (no expiry). */
export const UNLIMITED_DURATION = 0 as const
export type DurationChoice = DurationMonths | typeof UNLIMITED_DURATION

export function gbToBytes(gb: number) {
  return Math.round(gb * BYTES_PER_GB)
}

export function bytesToGb(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100
}

export function isValidDataLimitBytes(bytes: number) {
  return Number.isFinite(bytes) && bytes >= MIN_DATA_LIMIT_BYTES
}

export function isValidDataLimitGb(gb: number) {
  return Number.isFinite(gb) && gb >= MIN_DATA_LIMIT_GB
}

export function isUnlimitedDuration(
  months: number | null | undefined,
): months is typeof UNLIMITED_DURATION {
  return months === UNLIMITED_DURATION
}

export function expireAtFromMonths(
  months: DurationMonths,
  from: Date = new Date(),
) {
  const date = new Date(from.getTime())
  date.setMonth(date.getMonth() + months)
  return date
}

/** Returns `null` for unlimited plans. */
export function expireAtFromDuration(
  months: DurationChoice,
  from: Date = new Date(),
): Date | null {
  if (isUnlimitedDuration(months)) return null
  return expireAtFromMonths(months, from)
}

/**
 * Renew from remaining time when still active; otherwise start from now.
 * Extends by the selected plan duration (1 / 2 / 3 months), or clears expiry
 * when unlimited is chosen.
 */
export function renewExpireAt(
  currentExpireAt: Date | string | null | undefined,
  months: DurationChoice,
  now: Date = new Date(),
): Date | null {
  if (isUnlimitedDuration(months)) return null

  const current =
    currentExpireAt == null
      ? null
      : typeof currentExpireAt === 'string'
        ? new Date(currentExpireAt)
        : currentExpireAt

  const base =
    current &&
    !Number.isNaN(current.getTime()) &&
    current.getTime() > now.getTime()
      ? current
      : now

  return expireAtFromMonths(months, base)
}

export function durationLabel(months: DurationChoice) {
  if (isUnlimitedDuration(months)) return 'نامحدود'
  if (months === 1) return '۱ ماه'
  if (months === 2) return '۲ ماه'
  return '۳ ماه'
}

export const dataLimitGbSchema = z
  .number({ error: 'حجم را وارد کنید' })
  .finite()
  .min(MIN_DATA_LIMIT_GB, `حجم باید حداقل ${MIN_DATA_LIMIT_GB} گیگابایت باشد`)

export const durationMonthsSchema = z.union(
  [z.literal(1), z.literal(2), z.literal(3)],
  { error: 'مدت اشتراک را انتخاب کنید' },
)

export const durationChoiceSchema = z.union(
  [z.literal(0), z.literal(1), z.literal(2), z.literal(3)],
  { error: 'مدت اشتراک را انتخاب کنید' },
)

export function createVpnUserFormSchema(isAdmin: boolean) {
  return z.object({
    username: localUsernameSchema,
    dataLimitGb: dataLimitGbSchema,
    durationMonths: durationChoiceSchema,
    note: z.string().max(500, 'یادداشت حداکثر ۵۰۰ کاراکتر باشد').optional(),
    resellerId: isAdmin
      ? z.string().min(1, 'یک نماینده انتخاب کنید')
      : z.string().optional(),
  })
}

export type CreateVpnUserFormValues = z.infer<
  ReturnType<typeof createVpnUserFormSchema>
>

export const createVpnUserDefaults = {
  username: '',
  dataLimitGb: 25,
  durationMonths: 1 as DurationChoice,
  note: '',
  resellerId: '',
} satisfies CreateVpnUserFormValues

export const editVpnUserFormSchema = z.object({
  dataLimitGb: dataLimitGbSchema,
  note: z.string().max(500, 'یادداشت حداکثر ۵۰۰ کاراکتر باشد').optional(),
  /** Optional; any non-empty value is accepted (even 4 digits). Blank = keep current. */
  password: z.string().optional(),
})

export type EditVpnUserFormValues = z.infer<typeof editVpnUserFormSchema>

export const renewVpnUserFormSchema = z.object({
  durationMonths: durationChoiceSchema,
  dataLimitGb: dataLimitGbSchema,
  resetUsage: z.boolean(),
  reactivate: z.boolean(),
})

export type RenewVpnUserFormValues = z.infer<typeof renewVpnUserFormSchema>
