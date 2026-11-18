import { FormEvent, useState } from "react"
import type { PlatformUser } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { TextareaField } from "@iot-os/ui/components/form-fields"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

const REASON_LIMIT = 500

/**
 * Resets a locked-out person's two-step sign-in with a reason (spec 034, FR-024). Their
 * authenticator, recovery codes and passkeys stop working and they are signed out
 * everywhere; the reason goes into the activity log and they are emailed.
 *
 * Mounted only while open: its discard guard is a router blocker, and the Users page
 * already keeps one for the member dialogs.
 */
export function TwoStepResetDialog({
  user,
  onClose,
  onReset,
}: {
  user: PlatformUser | null
  onClose: () => void
  onReset: () => void
}) {
  return user ? <ResetDialog key={user.id} user={user} onClose={onClose} onReset={onReset} /> : null
}

function ResetDialog({ user, onClose, onReset }: { user: PlatformUser; onClose: () => void; onReset: () => void }) {
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { guard, dialog: discardDialog } = useDiscardGuard(reason.trim() !== "", {
    title: "Discard this reset?",
    description: "Their two-step sign-in stays as it is.",
  })

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = reason.trim()
    if (trimmed === "") {
      setErrors({ reason: ["Give a reason, such as how you checked who they are."] })
      return
    }
    setErrors(null)
    setFormError(null)
    setIsSubmitting(true)
    try {
      await apiClient.resetTwoStep(user.id, trimmed)
      toast.success(`Two-step sign-in reset for ${user.name}`, {
        description: "They were signed out everywhere and emailed.",
      })
      onClose()
      onReset()
    } catch (caught) {
      const fields = validationErrors(caught)
      setErrors(fields)
      setFormError(fields ? null : errorMessage(caught))
    } finally {
      setIsSubmitting(false)
    }
  }

  const passkeys = user.passkey_count ?? 0

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          {/* Room for the close button: a long name would run under it. */}
          <DialogHeader className="pr-6">
            <DialogTitle>Reset two-step sign-in for {user.name}?</DialogTitle>
            <DialogDescription>
              Their authenticator app and recovery codes
              {passkeys > 0 ? `, and their ${passkeys === 1 ? "passkey" : `${passkeys} passkeys`},` : ""} stop working,
              and they are signed out everywhere. They sign in with their password and set up two-step again. Check who
              they are before you reset.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              <TextareaField
                label="Reason"
                value={reason}
                maxLength={REASON_LIMIT}
                rows={3}
                required
                autoFocus
                help="Recorded in the activity log. Say how you checked who they are."
                error={fieldMessages(errors, "reason")?.join(" ")}
                onChange={(event) => {
                  setReason(event.target.value)
                  setErrors(null)
                }}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? "Resetting…" : "Reset two-step"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
