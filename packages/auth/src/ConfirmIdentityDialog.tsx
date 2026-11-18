import { type FormEvent, type ReactNode, useCallback, useRef, useState } from "react"
import { ApiError, ConfirmationRequiredError, type ApiClient } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"

/** The person closed the password dialog: the change was not made. */
export class ConfirmationCancelled extends Error {
  constructor() {
    super("The password was not confirmed.")
  }
}

/**
 * Asks for the password again before a security change (spec 034, FR-013). The API
 * answers `423` when the last confirmation is older than 15 minutes.
 */
export function ConfirmIdentityDialog({
  open,
  apiClient,
  onConfirmed,
  onCancel,
}: {
  open: boolean
  apiClient: ApiClient
  onConfirmed: () => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiClient.confirmPassword(password)
      setPassword("")
      onConfirmed()
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 422) {
        const payload = reason.payload as { errors?: { password?: string[] } } | null
        setError(payload?.errors?.password?.[0] ?? "That password is not right.")
      } else if (reason instanceof ApiError && reason.status === 429) {
        setError("Too many tries. Wait a minute and try again.")
      } else {
        setError("We could not check your password. Please try again.")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          setPassword("")
          setError(null)
          onCancel()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm it's you</DialogTitle>
          <DialogDescription>Enter your password to change how you sign in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={Boolean(error) || undefined}>
              <FieldLabel htmlFor="confirm-identity-password">Password</FieldLabel>
              <Input
                id="confirm-identity-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(error) || undefined}
              />
              {error ? (
                <FieldError errors={[{ message: error }]} />
              ) : (
                <FieldDescription>You won't be asked again for 15 minutes.</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !password}>
              {busy ? "Checking…" : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Runs a security change, asking for the password first when the API needs it: `run`
 * retries the action once the password is confirmed, and rejects with
 * {@link ConfirmationCancelled} if the person closes the dialog. Render `dialog`.
 */
export function useConfirmedAction(apiClient: ApiClient): {
  run: <T>(action: () => Promise<T>) => Promise<T>
  dialog: ReactNode
} {
  const [open, setOpen] = useState(false)
  const waiting = useRef<{ confirmed: () => void; cancelled: () => void } | null>(null)

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } catch (error) {
      if (!(error instanceof ConfirmationRequiredError)) throw error
    }
    await new Promise<void>((resolve, reject) => {
      waiting.current = { confirmed: resolve, cancelled: () => reject(new ConfirmationCancelled()) }
      setOpen(true)
    })
    return action()
  }, [])

  const settle = (outcome: "confirmed" | "cancelled") => {
    setOpen(false)
    const pending = waiting.current
    waiting.current = null
    pending?.[outcome]()
  }

  return {
    run,
    dialog: (
      <ConfirmIdentityDialog
        open={open}
        apiClient={apiClient}
        onConfirmed={() => settle("confirmed")}
        onCancel={() => settle("cancelled")}
      />
    ),
  }
}
