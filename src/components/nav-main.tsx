import { useI18n } from '#/components/locale-provider'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '#/components/ui/sidebar'

export function NavMain({
  items,
  label,
}: {
  label: string
  items: { title: string; url: string; icon: ReactNode; isActive: boolean }[]
}) {
  const { t, direction } = useI18n()

  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarGroup className="p-0" role="group" aria-label={t(label)}>
      <SidebarGroupLabel
        aria-hidden="true"
        className="mb-2 h-5 px-3 text-[11px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden"
      >
        {t(label)}
      </SidebarGroupLabel>
      <SidebarMenu className="gap-1">
        {items.map((item) => (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton
              isActive={item.isActive}
              aria-label={t(item.title)}
              aria-current={item.isActive ? 'page' : undefined}
              tooltip={{
                children: item.title,
                side: direction === 'rtl' ? 'left' : 'right',
              }}
              render={<Link to={item.url} />}
              onClick={() => isMobile && setOpenMobile(false)}
              className="relative h-11 gap-3 rounded-lg px-3 text-muted-foreground transition-colors hover:text-sidebar-foreground data-active:font-semibold group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
            >
              {item.isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-3 start-0 w-0.5 rounded-full bg-sidebar-primary"
                />
              ) : null}
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5"
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
                {t(item.title)}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
