import * as z from 'zod'

import { localUsernameSchema } from '#/lib/reseller-naming'

export const BYTES_PER_GB = 1024 ** 3

/** Data limit must be at least 10 GB. */
export const MIN_DATA_LIMIT_GB = 10
export const MIN_DATA_LIMIT_BYTES = MIN_DATA_LIMIT_GB * BYTES_PER_GB

export const DATA_PRESETS_GB = [25, 50, 100] as const

export const DURATION_DAYS = [30, 60, 90] as const
export type DurationDays = (typeof DURATION_DAYS)[number]

/** `0` means unlimited (no expiry). */
export const UNLIMITED_DURATION = 0 as const
export type DurationChoice = DurationDays | typeof UNLIMITED_DURATION

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
  duration: number | null | undefined,
): duration is typeof UNLIMITED_DURATION {
  return duration === UNLIMITED_DURATION
}

export function expireAtFromDays(days: DurationDays, from: Date = new Date()) {
  return new Date(from.getTime() + days * 86_400_000)
}

/** Returns `null` for unlimited plans. */
export function expireAtFromDuration(
  days: DurationChoice,
  from: Date = new Date(),
): Date | null {
  if (isUnlimitedDuration(days)) return null
  return expireAtFromDays(days, from)
}

/**
 * New renewals always begin now and last exactly 30, 60, or 90 days.
 */
export function renewExpireAt(
  _currentExpireAt: Date | string | null | undefined,
  days: DurationChoice,
  now: Date = new Date(),
): Date | null {
  if (isUnlimitedDuration(days)) return null

  return expireAtFromDays(days, now)
}

/** Legacy pending requests keep their original calendar-month semantics. */
export function renewExpireAtFromMonths(
  currentExpireAt: Date | string | null | undefined,
  months: 1 | 2 | 3,
  now: Date = new Date(),
) {
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

  const next = new Date(base.getTime())
  next.setMonth(next.getMonth() + months)
  return next
}

export function durationLabel(days: DurationChoice) {
  if (isUnlimitedDuration(days)) return 'نامحدود'
  if (days === 30) return '۳۰ روز'
  if (days === 60) return '۶۰ روز'
  return '۹۰ روز'
}

export const dataLimitGbSchema = z
  .number({ error: 'حجم را وارد کنید' })
  .finite()
  .min(MIN_DATA_LIMIT_GB, `حجم باید حداقل ${MIN_DATA_LIMIT_GB} گیگابایت باشد`)

export const durationDaysSchema = z.union(
  [z.literal(30), z.literal(60), z.literal(90)],
  { error: 'مدت اشتراک را انتخاب کنید' },
)

export const durationChoiceSchema = z.union(
  [z.literal(0), z.literal(30), z.literal(60), z.literal(90)],
  { error: 'مدت اشتراک را انتخاب کنید' },
)

export function createVpnUserFormSchema(isAdmin: boolean) {
  return z.object({
    username: localUsernameSchema,
    dataLimitGb: dataLimitGbSchema,
    durationDays: durationChoiceSchema,
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
  durationDays: 30 as DurationChoice,
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
  durationDays: durationChoiceSchema,
  additionalDataLimitGb: dataLimitGbSchema,
  reactivate: z.boolean(),
})

export type RenewVpnUserFormValues = z.infer<typeof renewVpnUserFormSchema>
