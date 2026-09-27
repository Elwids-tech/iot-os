import { useState } from "react"
import type { AuthenticatedUser } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardFooter, CardHeader } from "@iot-os/ui/components/card"
import { ShieldAlertIcon } from "lucide-react"
import { portalUrl } from "../lib/portal"

export function AccessDeniedPage({
  user,
  onSignOut,
}: {
  user: AuthenticatedUser
  onSignOut: () => Promise<void>
}) {
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function signOut() {
    setIsSigningOut(true)
    await onSignOut()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="font-semibold leading-none tracking-tight">
            Platform administration access required
          </h1>
        </CardHeader>
        <CardContent>
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>This account cannot access the admin panel</AlertTitle>
            <AlertDescription>
              {user.email} is an organization account. Use the tenant application or sign in with
              a platform administration account.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="gap-2">
          <Button asChild>
            <a href={portalUrl}>Open tenant portal</a>
          </Button>
          <Button variant="outline" disabled={isSigningOut} onClick={signOut}>
            {isSigningOut ? "Signing out…" : "Sign out"}
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
