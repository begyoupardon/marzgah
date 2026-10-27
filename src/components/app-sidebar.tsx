import { useI18n } from '#/components/locale-provider'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  ActivityIcon,
  BellIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  ReceiptIcon,
  UsersIcon,
  UsersRoundIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react'
import * as React from 'react'

import { BrandLogo } from '#/components/brand-logo'
import { NavMain } from '#/components/nav-main'
import { NavUser } from '#/components/nav-user'
import { Button } from '#/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '#/components/ui/sidebar'

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string; role: 'admin' | 'reseller' }
}

export function AppSidebar({ user, ...props }: AppSidebarProps) {
  const { t, direction } = useI18n()

  const pathname = useRouterState({
    select: (s) => s.location.pathname.replace(/\/+$/, '') || '/',
  })
  const { isMobile, setOpenMobile } = useSidebar()
  const item = (
    title: string,
    url: string,
    icon: React.ReactNode,
    exact = false,
  ) => ({
    title,
    url,
    icon,
    isActive: pathname === url || (!exact && pathname.startsWith(`${url}/`)),
  })

  return (
    <Sidebar
      collapsible="icon"
      side={direction === 'rtl' ? 'right' : 'left'}
      {...props}
    >
      <SidebarHeader className="h-14 shrink-0 justify-center gap-0 border-b border-sidebar-border px-3 py-0">
        <div className="flex min-w-0 items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
          <Link
            to="/dashboard"
            aria-label={t('مرزگاه؛ رفتن به داشبورد')}
            onClick={() => isMobile && setOpenMobile(false)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:flex-none"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-sidebar-accent/60"
            >
              <BrandLogo compact className="size-6" />
            </span>
            <span className="grid min-w-0 text-start group-data-[collapsible=icon]:hidden">
              <span className="text-base font-bold leading-5 text-sidebar-foreground">
                {t('مرزگاه')}
              </span>
              <span className="truncate text-[11px] leading-4 text-muted-foreground">
                {user.role === 'admin' ? t('پنل مدیریت') : t('پنل نماینده')}
              </span>
            </span>
          </Link>
          {isMobile ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('بستن منو')}
              onClick={() => setOpenMobile(false)}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-4 px-3 py-3 group-data-[collapsible=icon]:gap-3">
        <nav
          aria-label={t('ناوبری اصلی')}
          className="flex flex-col gap-4 group-data-[collapsible=icon]:gap-3"
        >
          <NavMain
            label={t('فضای کار')}
            items={[
              item(t('داشبورد'), '/dashboard', <LayoutDashboardIcon />),
              item(t('کاربران VPN'), '/users', <UsersIcon />),
              item(t('اعلان‌ها'), '/notifications', <BellIcon />),
            ]}
          />
          <NavMain
            label={t('امور مالی')}
            items={[
              item(t('آمار فروش'), '/analytics', <ChartColumnIcon />),
              item(t('تسویه و بدهی'), '/sales', <ReceiptIcon />),
              ...(user.role === 'reseller'
                ? [item(t('کیف پول'), '/wallet', <WalletIcon />)]
                : []),
            ]}
          />
          {user.role === 'admin' ? (
            <NavMain
              label={t('مدیریت سامانه')}
              items={[
                item(t('نمایندگان'), '/admin/resellers', <UsersRoundIcon />),
                item(t('وضعیت سامانه'), '/admin', <ActivityIcon />, true),
                item(t('رویدادها'), '/audit', <ClipboardListIcon />),
              ]}
            />
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-2 border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <SidebarCollapseControl />
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}

function SidebarCollapseControl() {
  const { t, direction } = useI18n()

  const { state, isMobile, toggleSidebar } = useSidebar()
  if (isMobile) return null
  const collapsed = state === 'collapsed'
  const label = collapsed ? t('باز کردن منو') : t('جمع کردن منو')
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          aria-label={t(label)}
          aria-expanded={!collapsed}
          aria-keyshortcuts="Control+b Meta+b"
          onClick={toggleSidebar}
          tooltip={{
            children: label,
            side: direction === 'rtl' ? 'left' : 'right',
          }}
          className="h-9 gap-3 rounded-lg px-3 text-muted-foreground group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
        >
          {collapsed ? (
            <PanelRightOpenIcon aria-hidden="true" className="ltr:rotate-180" />
          ) : (
            <PanelRightCloseIcon
              aria-hidden="true"
              className="ltr:rotate-180"
            />
          )}
          <span className="group-data-[collapsible=icon]:hidden">
            {t(label)}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
