import { useState } from "react"
import type { AuthenticatedUser } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@iot-os/ui/components/card"
import { AlertCircleIcon } from "lucide-react"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"
import { portalUrl } from "../lib/portal"

/**
 * The admin app and the portal share one session, so while a super administrator
 * impersonates someone the admin app is signed in as that person. It offers the portal
 * and leaving, which returns to the admin page impersonation started from.
 */
export function ImpersonatingPage({ user }: { user: AuthenticatedUser }) {
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function leave() {
    setLeaving(true)
    setError(null)
    try {
      window.location.assign(await apiClient.leaveImpersonation())
    } catch (caught) {
      setError(errorMessage(caught))
      setLeaving(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="text-heading">You are impersonating {user.name}</h1>
          <CardDescription>
            This browser is signed in as {user.email}. Leave to become {user.impersonation?.impersonator.name} again
            and return to where you started.
          </CardDescription>
        </CardHeader>
        {error ? (
          <CardContent>
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        <CardFooter className="gap-2">
          <Button disabled={leaving} onClick={() => void leave()}>
            {leaving ? "Leaving…" : "Leave impersonation"}
          </Button>
          <Button variant="outline" asChild>
            <a href={portalUrl}>Open portal</a>
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
