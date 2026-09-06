import { FormEvent, useEffect, useState } from "react"
import {
  ApiError,
  type AuthenticatedUser,
  type InvitationDetails,
} from "@iot-os/api-client"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { CheckCircle2Icon, AlertCircleIcon } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import type { ApiClient } from "@iot-os/api-client"

type FormErrors = {
  name?: string[]
  password?: string[]
  password_confirmation?: string[]
  email?: string[]
  form?: string
}

type InvitationState = {
  data?: InvitationDetails
  error: boolean
}

function invitationError(error: unknown): FormErrors {
  if (error instanceof ApiError && error.status === 422) {
    const payload = error.payload as { errors?: FormErrors }
    return (
      payload.errors ?? { form: "Review the invitation details and try again." }
    )
  }

  return { form: "This invitation could not be completed. Try again." }
}

export function AcceptInvitationPage({
  apiClient,
  portalUrl = "/",
}: {
  apiClient: ApiClient
  portalUrl?: string
}) {
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [state, setState] = useState<InvitationState>({ error: false })
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirmation, setPasswordConfirmation] = useState("")
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [acceptedUser, setAcceptedUser] = useState<AuthenticatedUser | null>(
    null,
  )

  useEffect(() => {
    let active = true

    if (!token) {
      setState({ error: true })
      return () => {
        active = false
      }
    }

    apiClient
      .invitation(token)
      .then((data) => {
        if (active) setState({ data, error: false })
      })
      .catch(() => {
        if (active) setState({ error: true })
      })

    return () => {
      active = false
    }
  }, [token, apiClient])

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setIsSubmitting(true)

    try {
      setAcceptedUser(
        await apiClient.acceptInvitation(token, {
          name,
          password,
          password_confirmation: passwordConfirmation,
        }),
      )
    } catch (error) {
      setErrors(invitationError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitExistingAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state.data) return

    setErrors({})
    setIsSubmitting(true)

    try {
      await apiClient.login({ email: state.data.email, password })
      setAcceptedUser(await apiClient.acceptInvitation(token))
    } catch (error) {
      setErrors(invitationError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (acceptedUser) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CheckCircle2Icon className="text-primary" />
            <CardTitle>
              <h1>Account ready</h1>
            </CardTitle>
            <CardDescription>
              You are signed in as {acceptedUser.email}. Your organization
              access has been added.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Your organization workspace is ready.
          </CardContent>
          <CardFooter>
            <Button asChild>
              <a href={portalUrl}>Open tenant portal</a>
            </Button>
          </CardFooter>
        </Card>
      </main>
    )
  }

  if (state.error) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              <h1>Invitation unavailable</h1>
            </CardTitle>
            <CardDescription>
              This invitation is invalid, expired, revoked, or already accepted.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }

  if (!state.data) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading invitation…
      </main>
    )
  }

  const isExistingAccount = state.data.acceptance_mode === "sign_in"

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>
              {isExistingAccount
                ? "Sign in to accept invitation"
                : "Create your account"}
            </h1>
          </CardTitle>
          <CardDescription>
            You have been invited to {state.data.organization.name} as{" "}
            {state.data.email}.
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={
            isExistingAccount ? submitExistingAccount : submitRegistration
          }
        >
          <CardContent>
            <FieldGroup>
              {!isExistingAccount ? (
                <Field data-invalid={Boolean(errors.name?.length)}>
                  <FieldLabel htmlFor="invitation-name">Name</FieldLabel>
                  <Input
                    id="invitation-name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={Boolean(errors.name?.length)}
                    required
                  />
                  <FieldError
                    errors={errors.name?.map((message) => ({ message }))}
                  />
                </Field>
              ) : null}
              <Field data-invalid={Boolean(errors.password?.length)}>
                <FieldLabel htmlFor="invitation-password">Password</FieldLabel>
                <Input
                  id="invitation-password"
                  type="password"
                  autoComplete={
                    isExistingAccount ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password?.length)}
                  required
                />
                <FieldError
                  errors={errors.password?.map((message) => ({ message }))}
                />
              </Field>
              {!isExistingAccount ? (
                <Field
                  data-invalid={Boolean(errors.password_confirmation?.length)}
                >
                  <FieldLabel htmlFor="invitation-password-confirmation">
                    Confirm password
                  </FieldLabel>
                  <Input
                    id="invitation-password-confirmation"
                    type="password"
                    autoComplete="new-password"
                    value={passwordConfirmation}
                    onChange={(event) =>
                      setPasswordConfirmation(event.target.value)
                    }
                    aria-invalid={Boolean(errors.password_confirmation?.length)}
                    required
                  />
                  <FieldError
                    errors={errors.password_confirmation?.map((message) => ({
                      message,
                    }))}
                  />
                </Field>
              ) : null}
              {errors.form || errors.email ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Could not accept invitation</AlertTitle>
                  <AlertDescription>
                    {errors.form ?? errors.email?.[0]}
                  </AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Completing invitation…"
                : isExistingAccount
                  ? "Sign in and accept"
                  : "Create account and accept"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
