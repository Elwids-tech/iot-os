import type { AuthenticatedUser } from "@iot-os/api-client"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { VenetianMaskIcon } from "lucide-react"

/**
 * While a super administrator impersonates the person, every page says so and offers to
 * leave, which returns to the admin page impersonation started from.
 */
export function ImpersonationBanner({ user, leaving, onLeave }: { user: AuthenticatedUser; leaving: boolean; onLeave: () => void }) {
  if (!user.impersonation) return null
  return (
    <div className="border-b px-4 py-3 md:px-6" role="status">
      <Alert className="border-warning/40 bg-warning/5">
        <VenetianMaskIcon />
        <AlertTitle>You are impersonating {user.name}</AlertTitle>
        <AlertDescription>
          Signed in as {user.email}. What you do is recorded as theirs, marked as done by {user.impersonation.impersonator.name}.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" disabled={leaving} onClick={onLeave}>
            {leaving ? "Leaving…" : "Leave impersonation"}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  )
}
