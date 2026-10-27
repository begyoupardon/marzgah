import { useI18n } from '#/components/locale-provider'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from 'cn'

import { useTheme } from '#/components/theme-provider'
import { useSidebar } from '#/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'

const themes = [
  { value: 'light', label: 'روشن', icon: Sun },
  { value: 'dark', label: 'تاریک', icon: Moon },
  { value: 'system', label: 'سیستم', icon: Monitor },
] as const

export function ModeToggle({ className }: { className?: string }) {
  const { state, isMobile } = useSidebar()
  return (
    <ThemeToggle
      collapsed={!isMobile && state === 'collapsed'}
      className={className}
    />
  )
}

export function ThemeToggle({
  className,
  collapsed = false,
}: {
  className?: string
  collapsed?: boolean
}) {
  const { t } = useI18n()

  const { theme, setTheme } = useTheme()

  if (collapsed) {
    const current = themes.find((item) => item.value === theme) ?? themes[2]
    const nextIndex =
      (themes.findIndex((item) => item.value === theme) + 1) % themes.length
    const next = themes[nextIndex]
    const Icon = current.icon

    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={t('تم: {0}. تغییر به {1}', {
                '0': t(current.label),
                '1': t(next.label),
              })}
              className={cn(
                'outline-none focus-visible:ring-2 focus-visible:ring-ring flex size-8 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                className,
              )}
              onClick={() => setTheme(next.value)}
            >
              <Icon className="size-4" />
            </button>
          }
        />
        <TooltipContent side="left">
          {t('تم: {0}', { '0': t(current.label) })}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('انتخاب تم')}
      className={cn(
        'grid grid-cols-3 gap-0.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-0.5',
        className,
      )}
    >
      {themes.map(({ value, label, icon: Icon }) => {
        const selected = theme === value
        return (
          <Tooltip key={value}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t(label)}
                  className={cn(
                    'outline-none focus-visible:ring-2 focus-visible:ring-ring flex h-7 items-center justify-center rounded-md transition-colors',
                    selected
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setTheme(value)}
                >
                  <Icon className="size-3.5" />
                </button>
              }
            />
            <TooltipContent side="top">{t(label)}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
