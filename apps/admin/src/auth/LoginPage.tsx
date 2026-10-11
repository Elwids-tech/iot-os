import { FormEvent, useState } from "react"
import { ApiError, type AuthenticatedUser } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@iot-os/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { apiClient } from "../lib/api-client"
import { portalUrl } from "../lib/portal"

type FormErrors = {
  email?: string[]
  password?: string[]
  form?: string
}

export function LoginPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthenticatedUser) => void
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setIsSubmitting(true)

    try {
      onAuthenticated(await apiClient.login({ email, password }))
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const payload = error.payload as { errors?: FormErrors }
        setErrors(payload.errors ?? { form: "Please check your details and try again." })
      } else if (error instanceof ApiError && error.status === 429) {
        const payload = error.payload as { message?: string } | null
        setErrors({ form: payload?.message ?? "Too many sign-in attempts. Try again in a minute." })
      } else {
        setErrors({ form: "We could not sign you in. Please try again." })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            Sign in to IoT OS
          </h1>
          <CardDescription>
            Use your platform administration account to manage organizations, users, and roles.
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.email?.length)}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(errors.email?.length)}
                  required
                />
                <FieldError errors={errors.email?.map((message) => ({ message }))} />
              </Field>
              <Field data-invalid={Boolean(errors.password?.length)}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password?.length)}
                  required
                />
                <FieldError errors={errors.password?.map((message) => ({ message }))} />
                <FieldDescription>
                  Tenant-only accounts use the customer application instead.
                </FieldDescription>
              </Field>
              <FieldError errors={errors.form ? [{ message: errors.form }] : undefined} />
              <a href={`${portalUrl.replace(/\/$/, "")}/forgot-password`} className="text-sm text-primary underline underline-offset-4">Forgot password?</a>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
