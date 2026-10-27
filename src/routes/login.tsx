import { useI18n } from '#/components/locale-provider'
import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'

import { AuthShell } from '#/components/auth-shell'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { QueryErrorState } from '#/components/query-error-state'
import { authClient } from '#/lib/auth-client'
import { bootstrapAdmin, getNeedsBootstrap } from '#/lib/bootstrap'
import { getErrorMessage } from '#/lib/errors'
import { getAppSession } from '#/lib/session'
import { toastError, toastSuccess } from '#/lib/toast'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const session = await getAppSession()
    if (session?.user) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const { t } = useI18n()

  const navigate = useNavigate()
  const router = useRouter()
  const finishSignIn = async () => {
    await router.invalidate()
    await navigate({ to: '/dashboard' })
  }
  const bootstrapQuery = useQuery({
    queryKey: ['needs-bootstrap'],
    queryFn: () => getNeedsBootstrap(),
  })

  if (bootstrapQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-sm text-muted-foreground">
        {t('در حال بارگذاری…')}
      </div>
    )
  }

  if (bootstrapQuery.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <QueryErrorState
          error={bootstrapQuery.error}
          title={t('بارگذاری صفحه ورود انجام نشد')}
          onRetry={() => void bootstrapQuery.refetch()}
        />
      </div>
    )
  }

  if (bootstrapQuery.data?.needsBootstrap) {
    return (
      <BootstrapForm
        bootstrapEmail={bootstrapQuery.data.bootstrapEmail}
        onDone={() => void finishSignIn()}
      />
    )
  }

  return <SignInForm onDone={() => void finishSignIn()} />
}

function SignInForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      })
      if (result.error) {
        const message = t(getErrorMessage(result.error, 'ورود ناموفق بود'))
        setError(message)
        toastError(t('ورود ناموفق بود'), result.error)
        return
      }
      toastSuccess(t('ورود موفق'))
      onDone()
    } catch (err) {
      const message = t(getErrorMessage(err, 'ورود ناموفق بود'))
      setError(message)
      toastError(t('ورود ناموفق بود'), err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle>{t('ورود به مرزگاه')}</CardTitle>
          <CardDescription>
            {t('نمایندگان فقط توسط مدیر سامانه اضافه می‌شوند')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">{t('ایمیل')}</Label>
              <Input
                id="email"
                dir="ltr"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('رمز عبور')}</Label>
              <Input
                id="password"
                dir="ltr"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t(error)}
              </p>
            ) : null}
            <Button className="w-full" disabled={loading} type="submit">
              {loading ? t('در حال ورود…') : t('ورود')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="max-w-md space-y-2 text-center text-xs leading-relaxed text-muted-foreground">
        <span className="block">
          {t(
            'مرزگاه یک پنل مستقل است و وابسته به Circle Internet Financial نیست.',
          )}
        </span>
      </p>
    </AuthShell>
  )
}

function BootstrapForm({
  bootstrapEmail,
  onDone,
}: {
  bootstrapEmail: string | null
  onDone: () => void
}) {
  const { t } = useI18n()

  const [name, setName] = useState(t('مدیر'))
  const [email, setEmail] = useState(bootstrapEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await bootstrapAdmin({ data: { email, name, password } })
      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      })
      if (result.error) {
        const message = t(
          getErrorMessage(result.error, 'مدیر ساخته شد اما ورود ناموفق بود'),
        )
        setError(message)
        toastError(t('ورود پس از راه‌اندازی ناموفق بود'), result.error)
        return
      }
      toastSuccess(t('مدیر ایجاد شد'))
      onDone()
    } catch (err) {
      const message = t(getErrorMessage(err, 'راه‌اندازی ناموفق بود'))
      setError(message)
      toastError(t('راه‌اندازی ناموفق بود'), err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle>{t('ایجاد مدیر')}</CardTitle>
          <CardDescription>
            {t('راه‌اندازی یک‌باره. ایمیل باید با')}{' '}
            <code className="text-xs">BOOTSTRAP_ADMIN_EMAIL</code>{' '}
            {t('یکسان باشد')}
            {bootstrapEmail ? ` (${bootstrapEmail})` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">{t('نام')}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t('ایمیل')}</Label>
              <Input
                id="email"
                dir="ltr"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('رمز عبور')}</Label>
              <Input
                id="password"
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t(error)}
              </p>
            ) : null}
            <Button className="w-full" disabled={loading} type="submit">
              {loading ? t('در حال ایجاد…') : t('ایجاد مدیر')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
