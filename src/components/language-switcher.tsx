import { LanguagesIcon } from 'lucide-react'
import { useI18n } from '#/components/locale-provider'
import { Button } from '#/components/ui/button'

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()
  const next = locale === 'fa' ? 'en' : 'fa'
  return (
    <Button
      variant="outline"
      className="h-9 gap-2 px-3"
      aria-label={
        locale === 'fa' ? 'Switch language to English' : 'تغییر زبان به فارسی'
      }
      onClick={() => setLocale(next)}
    >
      <LanguagesIcon aria-hidden="true" />
      <span lang={next}>{next === 'en' ? 'English' : 'فارسی'}</span>
    </Button>
  )
}
