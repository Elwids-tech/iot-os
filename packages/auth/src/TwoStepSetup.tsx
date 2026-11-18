import { type FormEvent, useState } from "react"
import { ApiError, type ApiClient, type TwoStepSetup as Setup } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { CopyButton } from "@iot-os/ui/components/copy-text"
import { Field, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { SixDigitCode } from "@iot-os/ui/components/input-otp"
import { ShieldCheckIcon } from "lucide-react"
import { RecoveryCodes } from "./RecoveryCodes"

/** The QR code as an image: the SVG from the API is never injected as HTML. */
export function qrImageSource(svg: string) {
  let binary = ""
  for (const byte of new TextEncoder().encode(svg)) binary += String.fromCharCode(byte)
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

/**
 * Turning on two-step sign-in (spec 034, FR-001 to FR-005): scan the QR code or type the
 * setup key, confirm a code from the app, then save the recovery codes. Two-step is on
 * once the code is confirmed (`onEnabled`); **Done** comes after the codes are saved.
 */
export function TwoStepSetup({
  apiClient,
  setup,
  onEnabled,
  onDone,
  onCancel,
}: {
  apiClient: ApiClient
  setup: Setup
  onEnabled?: () => void
  onDone: () => void
  onCancel: () => void
}) {
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)

  async function confirm(value: string) {
    if (submitting) return
    if (value.length < 6) return setError("Enter all six digits.")
    setSubmitting(true)
    setError(null)
    try {
      setCodes(await apiClient.confirmTwoStep(value))
      onEnabled?.()
    } catch (reason) {
      setCode("")
      if (reason instanceof ApiError && reason.status === 422) {
        const payload = reason.payload as { errors?: { code?: string[] } } | null
        setError(payload?.errors?.code?.[0] ?? "That code is not valid.")
      } else if (reason instanceof ApiError && reason.status === 409) {
        setError("Two-step sign-in is already on. Close this and reload the page.")
      } else if (reason instanceof ApiError && reason.status === 429) {
        setError("Too many tries. Wait a minute and try again.")
      } else {
        setError("We could not check that code. Please try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (codes)
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>Two-step sign-in is on</AlertTitle>
          <AlertDescription>From now on, signing in asks for a code from your app after your password.</AlertDescription>
        </Alert>
        <h3 className="text-heading">Save your recovery codes</h3>
        <RecoveryCodes codes={codes} onDone={onDone} />
      </div>
    )

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void confirm(code)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="text-heading">1. Scan the QR code</h3>
        <p className="text-body text-muted-foreground">
          Open an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password,
          and add an account with this QR code.
        </p>
        {/* The QR code keeps a light background in dark mode, so phones can read it. */}
        <img
          src={qrImageSource(setup.qr_svg)}
          alt="QR code to add this account to an authenticator app"
          className="size-44 self-center rounded-lg border bg-card p-2 dark:bg-foreground"
        />
        <div className="flex flex-col gap-1">
          <span className="text-meta text-muted-foreground">Can't scan it? Enter this setup key instead:</span>
          <span className="flex items-center gap-1">
            <code className="font-mono text-code break-all" data-testid="two-step-setup-key">
              {setup.setup_key}
            </code>
            <CopyButton value={setup.setup_key.replace(/\s+/g, "")} label="setup key" />
          </span>
        </div>
      </section>
      <FieldGroup>
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="two-step-setup-code" className="text-heading">
            2. Enter the six-digit code the app shows
          </FieldLabel>
          <SixDigitCode
            id="two-step-setup-code"
            value={code}
            onChange={(value) => {
              setCode(value)
              if (error) setError(null)
            }}
            onComplete={(value) => void confirm(value)}
            invalid={Boolean(error)}
          />
          <FieldError errors={error ? [{ message: error }] : undefined} />
        </Field>
      </FieldGroup>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Checking…" : "Turn on"}
        </Button>
      </div>
    </form>
  )
}
