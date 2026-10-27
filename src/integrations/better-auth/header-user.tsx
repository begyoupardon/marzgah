import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'

export default function BetterAuthHeader() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return <div className="size-8 animate-pulse rounded-md bg-muted" />
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        {session.user.image ? (
          <img
            src={session.user.image}
            alt=""
            className="size-8 rounded-md object-cover"
          />
        ) : (
          <div className="flex size-8 items-center justify-center rounded-md bg-muted">
            <span className="text-xs font-medium text-muted-foreground">
              {session.user.name?.charAt(0).toUpperCase() || 'U'}
            </span>
          </div>
        )}
        <Button variant="outline" onClick={() => void authClient.signOut()}>
          Sign out
        </Button>
      </div>
    )
  }

  return null
}
