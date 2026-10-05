import { type FormEvent, useState } from "react"
import { ApiError, type ApiClient } from "@iot-os/api-client"
import { Link, useSearchParams } from "react-router-dom"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { CheckCircle2Icon } from "lucide-react"

type Errors = Partial<Record<"email" | "password" | "password_confirmation" | "token", string[]>> & { form?: string }

export function PasswordRecoveryPage({ apiClient, mode }: { apiClient: ApiClient; mode: "request" | "reset" }) {
  const [params, setParams] = useSearchParams()
  const token = params.get("token") ?? ""
  const [email, setEmail] = useState(mode === "reset" ? params.get("email") ?? "" : "")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)
  const reset = mode === "reset"
  const unavailable = reset && (!token || !email || Boolean(errors.token))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setSubmitting(true)
    try {
      if (reset) {
        await apiClient.resetPassword({ email, token, password, password_confirmation: confirmation })
        setPassword("")
        setConfirmation("")
        setParams({}, { replace: true })
      } else {
        await apiClient.requestPasswordReset(email)
      }
      setComplete(true)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const payload = error.payload as { errors?: Errors }
        setErrors(payload.errors ?? { form: "Please check your details and try again." })
      } else {
        setErrors({ form: error instanceof ApiError && error.status === 429
          ? "Too many attempts. Please wait before trying again."
          : "We could not complete your request. Please try again." })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          {complete && <CheckCircle2Icon className="text-primary" />}
          <CardTitle><h1>{complete ? reset ? "Password reset" : "Check your email" : unavailable ? "Reset link unavailable" : reset ? "Choose a new password" : "Forgot your password?"}</h1></CardTitle>
          <CardDescription>
            {complete ? reset ? "Your password has been changed. Sign in with your new password."
              : "If an account exists for that email address, we will send a password reset link. Check your spam folder too."
              : unavailable ? "This link is invalid, expired, or already used. Request a new link to continue."
              : reset ? "Use at least 12 characters. You will need to sign in again on your other devices."
              : "Enter your account email and we’ll send you a link to reset your password."}
          </CardDescription>
        </CardHeader>
        {complete || unavailable ? (
          <CardFooter className="flex flex-col items-stretch gap-3">
            {unavailable && !complete && <Button asChild><Link to="/forgot-password">Request a new link</Link></Button>}
            <Button asChild variant="outline"><a href="/">Back to sign in</a></Button>
          </CardFooter>
        ) : (
          <form onSubmit={submit}>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.email?.length)}>
                  <FieldLabel htmlFor="recovery-email">Email address</FieldLabel>
                  <Input id="recovery-email" type="email" autoComplete="email" maxLength={254} required value={email} readOnly={reset} onChange={event => setEmail(event.target.value)} aria-invalid={Boolean(errors.email?.length)} />
                  <FieldError errors={errors.email?.map(message => ({ message }))} />
                </Field>
                {reset && <>
                  <Field data-invalid={Boolean(errors.password?.length)}>
                    <FieldLabel htmlFor="recovery-password">New password</FieldLabel>
                    <Input id="recovery-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={event => setPassword(event.target.value)} aria-invalid={Boolean(errors.password?.length)} aria-describedby="password-length" />
                    <FieldDescription id="password-length">At least 12 characters.</FieldDescription>
                    <FieldError errors={errors.password?.map(message => ({ message }))} />
                  </Field>
                  <Field data-invalid={Boolean(errors.password_confirmation?.length)}>
                    <FieldLabel htmlFor="recovery-confirmation">Confirm new password</FieldLabel>
                    <Input id="recovery-confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={confirmation} onChange={event => setConfirmation(event.target.value)} aria-invalid={Boolean(errors.password_confirmation?.length)} />
                    <FieldError errors={errors.password_confirmation?.map(message => ({ message }))} />
                  </Field>
                </>}
                {errors.form && <Alert variant="destructive"><AlertTitle>Request unsuccessful</AlertTitle><AlertDescription>{errors.form}</AlertDescription></Alert>}
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? "Please wait…" : reset ? "Reset password" : "Send reset link"}</Button>
              <Button asChild variant="ghost"><a href="/">Back to sign in</a></Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </main>
  )
}
