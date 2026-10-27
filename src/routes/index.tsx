import { LanguageSwitcher } from '#/components/language-switcher'
import { useI18n } from '#/components/locale-provider'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { getAppSession } from '#/lib/session'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await getAppSession()
    if (session?.user) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: HomePage,
})

function HomePage() {
  const { t } = useI18n()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <div className="max-w-lg space-y-3 text-center">
        <p className="text-sm text-muted-foreground">Marzgah</p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('مرزگاه')}</h1>
        <p className="text-muted-foreground">
          {t('پنل مدیریت نمایندگان — برند مستقل')}
        </p>
      </div>

      <Button nativeButton={false} render={<Link to="/login" />}>
        {t('ورود به سامانه')}
      </Button>

      <div className="max-w-xl space-y-3 text-center text-xs leading-relaxed text-muted-foreground">
        <p>
          {t(
            'مرزگاه یک پنل مستقل مدیریت نمایندگان است و هیچ‌گونه وابستگی، تایید یا ارتباطی با شرکت Circle Internet Financial یا محصولات مرتبط با آن ندارد.',
          )}
        </p>
        <p>
          <a className="underline underline-offset-2" href="/brand.txt">
            brand.txt
          </a>
        </p>
      </div>
    </div>
  )
}
