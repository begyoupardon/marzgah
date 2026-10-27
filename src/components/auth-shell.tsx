import { LanguageSwitcher } from '#/components/language-switcher'
import { useI18n } from '#/components/locale-provider'
import type { ReactNode } from 'react'

import { BrandLogo } from '#/components/brand-logo'
import { ThemeToggle } from '#/components/mode-toggle'
import { TooltipProvider } from '#/components/ui/tooltip'

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()

  return (
    <TooltipProvider>
      <main className="relative flex min-h-svh flex-col items-center justify-center gap-6 overflow-hidden px-4 py-12 sm:px-6">
        <div
          aria-hidden="true"
          className="brand-pattern absolute inset-x-0 top-0 h-1/3 border-b border-border"
        />
        <div className="relative flex w-full max-w-md flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-8 py-5 shadow-sm">
            <BrandLogo className="w-40" />
            <p className="text-xs text-muted-foreground">
              {t('پنل مدیریت نمایندگان')}
            </p>
          </div>
          {children}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <ThemeToggle className="w-36" />
            <LanguageSwitcher />
          </div>
        </div>
      </main>
    </TooltipProvider>
  )
}
