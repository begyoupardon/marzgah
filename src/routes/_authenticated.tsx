import { useI18n } from '#/components/locale-provider'
import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { AppSidebar } from '#/components/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '#/components/ui/breadcrumb'
import { Separator } from '#/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '#/components/ui/sidebar'
import { TooltipProvider } from '#/components/ui/tooltip'
import { getAppSession } from '#/lib/session'
import { orpc } from '#/orpc/client'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const session = await getAppSession()
    if (!session?.user) throw redirect({ to: '/login' })
    return { session }
  },
  component: AuthenticatedLayout,
})

const pageTitles: Array<[string, string]> = [
  ['/wallet', 'کیف پول'],
  ['/notifications', 'اعلان‌ها'],
  ['/admin/resellers', 'نمایندگان'],
  ['/admin', 'وضعیت سامانه'],
  ['/analytics', 'آمار فروش'],
  ['/sales', 'تسویه و بدهی'],
  ['/audit', 'رویدادها'],
  ['/dashboard', 'داشبورد'],
  ['/users', 'کاربران VPN'],
]

function AuthenticatedLayout() {
  const { t } = useI18n()

  const { session } = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const announcement = useQuery({
    ...orpc.tools.announcement.queryOptions(),
    refetchInterval: 5 * 60_000,
  }).data

  const title =
    pageTitles.find(([path]) => pathname.startsWith(path))?.[1] ??
    t('پنل مدیریت')

  const user = {
    name: session.user.name || session.user.email,
    email: session.user.email,
    role: session.user.role,
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar user={user} />
        <SidebarInset className="min-w-0">
          <header className="flex h-14 shrink-0 items-center border-b bg-card">
            <div className="mx-auto flex w-full max-w-[1440px] items-center gap-2 px-4 sm:px-6 lg:px-8">
              <SidebarTrigger className="-ms-1 md:hidden" />
              <Separator
                orientation="vertical"
                className="me-2 data-vertical:h-4 data-vertical:self-auto md:hidden"
              />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{t(title)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </header>
          <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {announcement ? (
              <div
                role="status"
                className={
                  announcement.level === 'warning'
                    ? 'rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-6'
                    : 'rounded-xl border bg-card px-4 py-3 text-sm leading-6'
                }
              >
                {announcement.text}
              </div>
            ) : null}
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
