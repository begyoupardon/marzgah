import { useI18n } from '#/components/locale-provider'
import {
  ChevronsUpDownIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTheme } from '#/components/theme-provider'
import { getErrorMessage } from '#/lib/errors'

import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '#/components/ui/sidebar'
import { toast } from '#/components/ui/toast'
import { authClient } from '#/lib/auth-client'

function initials(name: string, email: string) {
  const source = name.trim() || email.trim()
  if (!source) return '؟'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    role: 'admin' | 'reseller'
    avatar?: string
  }
}) {
  const { t, direction, locale, setLocale } = useI18n()

  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const [signingOut, setSigningOut] = useState(false)
  const fallback = initials(user.name, user.email)
  const roleLabel = user.role === 'admin' ? t('مدیر') : t('نماینده')

  async function signOut() {
    setSigningOut(true)
    try {
      const result = await authClient.signOut()
      if (result.error) throw result.error
      window.location.assign('/login')
    } catch (error) {
      toast.add({
        type: 'error',
        title: t('خروج انجام نشد'),
        description: t(getErrorMessage(error)),
      })
      setSigningOut(false)
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                aria-label={t('حساب کاربری {0}', {
                  '0': user.name || user.email,
                })}
                tooltip={{
                  children: t('حساب کاربری و تنظیمات نمایش'),
                  side: direction === 'rtl' ? 'left' : 'right',
                }}
                className="h-14 gap-3 rounded-xl bg-sidebar-accent/40 px-3 ring-1 ring-sidebar-border aria-expanded:bg-sidebar-accent group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
              />
            }
          >
            <Avatar className="size-9">
              {user.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary">
                {fallback}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 gap-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-medium">
                {user.name || user.email}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {t(roleLabel)}
              </span>
            </div>
            <ChevronsUpDownIcon
              aria-hidden="true"
              className="ms-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64 max-w-[calc(100vw-2rem)] rounded-xl p-2"
            side={isMobile ? 'top' : direction === 'rtl' ? 'left' : 'right'}
            align="end"
            sideOffset={12}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex min-w-0 items-center gap-3 p-2 text-start text-sm">
                  <Avatar>
                    {user.avatar ? (
                      <AvatarImage src={user.avatar} alt={user.name} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {fallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 gap-1 text-start text-sm leading-tight">
                    <span className="truncate font-medium">
                      {user.name || user.email}
                    </span>
                    <span
                      dir="ltr"
                      className="truncate text-start text-xs text-muted-foreground"
                    >
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-2 text-xs text-muted-foreground">
                {t('تنظیمات نمایش')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (
                    value === 'light' ||
                    value === 'dark' ||
                    value === 'system'
                  )
                    setTheme(value)
                }}
              >
                {[
                  { value: 'light', label: t('روشن'), icon: SunIcon },
                  { value: 'dark', label: t('تاریک'), icon: MoonIcon },
                  {
                    value: 'system',
                    label: t('همگام با سیستم'),
                    icon: MonitorIcon,
                  },
                ].map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    className="min-h-10 gap-3 ps-2"
                  >
                    <Icon aria-hidden="true" />
                    {t(label)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-2 text-xs text-muted-foreground">
                {locale === 'fa' ? 'زبان' : 'Language'}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(value) => {
                  if (value === 'fa' || value === 'en') setLocale(value)
                }}
              >
                <DropdownMenuRadioItem value="fa" className="min-h-10 ps-2">
                  <span lang="fa">فارسی</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="en" className="min-h-10 ps-2">
                  <span lang="en">English</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={signingOut}
              className="min-h-10 gap-3 px-2"
              onClick={() => void signOut()}
            >
              <LogOutIcon aria-hidden="true" />
              {signingOut ? t('در حال خروج…') : t('خروج از حساب')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
