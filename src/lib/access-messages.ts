import type { Translator } from '#/lib/i18n/core'
const messages: Record<string, string> = {
  'Select at least one inbound': 'حداقل یک اینباند انتخاب کنید',
  'An inbound is unavailable. Refresh the catalog.':
    'یکی از اینباندها در دسترس نیست؛ فهرست را بازخوانی کنید.',
  'Access template is unavailable':
    'قالب دسترسی در دسترس نیست؛ قالب دیگری انتخاب کنید.',
  'Access changed. Refresh and review again.':
    'دسترسی تغییر کرده است؛ بازخوانی کنید و دوباره بازبینی کنید.',
  'Selection contains admin-controlled or unapproved inbounds':
    'انتخاب شما شامل اینباند تأییدنشده یا تحت کنترل مدیر است.',
  'Reseller account is disabled': 'حساب نماینده غیرفعال است',
  'VPN user not found': 'کاربر VPN پیدا نشد',
  'This backend does not support inbound management':
    'این سرویس از مدیریت اینباند پشتیبانی نمی‌کند.',
  'Backend does not support inbound management':
    'این سرویس از مدیریت اینباند پشتیبانی نمی‌کند.',
  'Inbound is unavailable': 'اینباند در دسترس نیست',
  'Duplicate template or reseller': 'قالب یا نماینده تکراری است.',
  'Reseller not found': 'نماینده پیدا نشد',
  'Idempotency key already used for another request':
    'شناسه درخواست برای عملیات دیگری استفاده شده است.',
  'VPN operation recovery is pending':
    'بازیابی عملیات VPN در انتظار است؛ اعمال دسترسی پس از آن ادامه می‌یابد.',
  'Access changed during application':
    'دسترسی هنگام اعمال تغییر کرده است؛ تلاش مجدد انجام می‌شود.',
  'A newer access revision is pending':
    'نسخه جدیدتری از دسترسی در انتظار اعمال است.',
  'Backend has not applied the requested selection':
    'سرویس هنوز انتخاب درخواستی را اعمال نکرده است.',
  'Access application failed': 'اعمال دسترسی انجام نشد',
  applied: 'اعمال‌شده',
  pending: 'در انتظار',
  failed: 'ناموفق',
  skipped: 'ردشده',
}
export function accessMessage(message: string, t: Translator): string {
  const prefix = 'Policy would remove all access from '
  if (message.startsWith(prefix))
    return t('این سیاست همه دسترسی‌های کاربر {0} را حذف می‌کند.', {
      0: message.slice(prefix.length),
    })
  return t(messages[message] ?? message)
}
