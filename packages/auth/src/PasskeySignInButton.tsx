import { useEffect, useRef, useState } from "react"
import type { ApiClient, AuthenticatedUser } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { FieldError } from "@iot-os/ui/components/field"
import { Separator } from "@iot-os/ui/components/separator"
import { KeyRoundIcon } from "lucide-react"
import {
  PasskeysUnavailableError,
  cancelPasskey,
  offerPasskeyAutofill,
  passkeyProblem,
  passkeysSupported,
  signInWithPasskey,
} from "./passkeys"

/**
 * Sign in with a passkey alone (spec 034, FR-017, FR-018). A passkey counts as both
 * steps, so it also finishes a sign-in waiting for a code.
 *
 * - Hidden when the browser cannot use passkeys, or the deployment cannot offer them
 *   (the API answers `404` when its front ends are not on HTTPS).
 * - With `autofill`, the email field marked `autocomplete="… webauthn"` also lists the
 *   browser's saved passkeys.
 * - `remember` is read when the passkey is used, so it follows **Keep me signed in**.
 * - Closing the browser's prompt says nothing.
 */
export function PasskeySignInButton({
  apiClient,
  remember,
  onSignedIn,
  autofill = false,
  label = "Sign in with a passkey",
  variant = "outline",
  divider = false,
}: {
  apiClient: ApiClient
  remember: () => boolean
  onSignedIn: (user: AuthenticatedUser) => void
  autofill?: boolean
  label?: string
  variant?: "outline" | "default"
  /** An "or" line above the button, shown only with the button. */
  divider?: boolean
}) {
  const [supported] = useState(passkeysSupported)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // The latest callbacks, so the autofill started on mount signs in with current choices.
  const latest = useRef({ remember, onSignedIn })
  useEffect(() => {
    latest.current = { remember, onSignedIn }
  })

  useEffect(() => {
    if (!supported || !autofill) return
    let active = true
    offerPasskeyAutofill(apiClient, () => latest.current.remember())
      .then((user) => {
        if (active && user) latest.current.onSignedIn(user)
      })
      .catch((error: unknown) => {
        if (!active) return
        if (error instanceof PasskeysUnavailableError) setUnavailable(true)
        else setProblem(passkeyProblem(error, "sign_in"))
      })
    return () => {
      active = false
      cancelPasskey()
    }
  }, [apiClient, autofill, supported])

  if (!supported || unavailable) return null

  async function signIn() {
    setBusy(true)
    setProblem(null)
    try {
      latest.current.onSignedIn(await signInWithPasskey(apiClient, latest.current.remember()))
    } catch (error) {
      if (error instanceof PasskeysUnavailableError) setUnavailable(true)
      else setProblem(passkeyProblem(error, "sign_in"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {divider && (
        <div className="flex items-center gap-3 text-meta text-muted-foreground" aria-hidden="true">
          <Separator className="h-px flex-1" />
          or
          <Separator className="h-px flex-1" />
        </div>
      )}
      <Button type="button" variant={variant} className="w-full" disabled={busy} onClick={() => void signIn()}>
        <KeyRoundIcon />
        {busy ? "Waiting for your passkey…" : label}
      </Button>
      <FieldError errors={problem ? [{ message: problem }] : undefined} />
    </div>
  )
}
