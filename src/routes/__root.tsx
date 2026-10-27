import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { LocaleProvider } from '#/components/locale-provider'
import { getRequestLocale } from '#/lib/i18n/request'
import { directionFor, createTranslator } from '#/lib/i18n/core'
import appCss from '../styles.css?url'
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from '#/components/ui/toast'
import { ThemeProvider } from '#/components/theme-provider'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async () => ({ locale: await getRequestLocale() }),
  head: ({ match }) => ({
    meta: [
      { name: 'theme-color', content: '#fbf9f5' },
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: createTranslator(match.context.locale)('مرزگاه | Marzgah'),
      },
      {
        name: 'application-name',
        content: 'Marzgah',
      },
      {
        name: 'description',
        content:
          'Marzgah is an independent reseller admin panel. Not affiliated with Circle Internet Financial, Inc., circle.com, USDC, or any Circle-branded product.',
      },
      {
        name: 'author',
        content: 'Marzgah',
      },
    ],
    links: [
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { locale } = Route.useRouteContext()
  return (
    <html lang={locale} dir={directionFor(locale)} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider defaultTheme="system" storageKey="theme">
          <LocaleProvider initialLocale={locale}>
            {children}
            <Toaster />
          </LocaleProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
