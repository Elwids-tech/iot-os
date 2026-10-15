import { useState } from "react"
import type { PlatformUser } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"

export type PlatformAdministratorAction = { kind: "grant" | "revoke"; user: PlatformUser }

/** Confirms granting or removing the platform-administrator role (spec 008). */
export function PlatformAdministratorDialog({
  action,
  onClose,
  onChanged,
}: {
  action: PlatformAdministratorAction | null
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const granting = action?.kind === "grant"

  function close() {
    if (busy) return
    setError(null)
    onClose()
  }

  async function confirm() {
    if (!action) return
    setBusy(true)
    setError(null)

    try {
      if (granting) {
        await apiClient.grantPlatformAdministrator(action.user.id)
        toast.success(`${action.user.name} is now a platform administrator`)
      } else {
        await apiClient.revokePlatformAdministrator(action.user.id)
        toast.success(`${action.user.name} is no longer a platform administrator`)
      }
      onClose()
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={action !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {granting
              ? `Make ${action?.user.name} a platform administrator?`
              : `Remove platform administrator access from ${action?.user.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {granting
              ? "They will be able to manage organizations, their roles and members, users, invitations and telemetry retention in the admin app. Their organization memberships stay as they are."
              : "They keep their account and organization memberships, and lose access to the admin app on their next request."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant={granting ? "default" : "destructive"} disabled={busy} onClick={() => void confirm()}>
            {granting
              ? busy
                ? "Granting…"
                : "Make platform administrator"
              : busy
                ? "Removing…"
                : "Remove access"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
