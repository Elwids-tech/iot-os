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
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"
import { portalUrl } from "../lib/portal"

/**
 * A super administrator signs in to the portal as someone else. The admin app and the
 * portal share one session, so this browser becomes the person until they leave, which
 * returns to this page.
 */
export function ImpersonateDialog({ user, onClose }: { user: PlatformUser | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (busy) return
    setError(null)
    onClose()
  }

  async function confirm() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await apiClient.impersonate(user.id, window.location.href)
      window.location.assign(portalUrl)
    } catch (caught) {
      setError(fieldMessages(validationErrors(caught), "user")?.[0] ?? errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={user !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Impersonate {user?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The portal opens signed in as {user?.email}, and you see and do what they can. What you do is recorded
            as theirs, marked as done by you. Leave from the menu or the banner to come back here.
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
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? "Opening the portal…" : "Impersonate"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
