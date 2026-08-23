import { FormEvent, useEffect, useState } from "react"
import { ApiClient, ApiError, type AuthenticatedUser } from "@iot-os/api-client"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"

type ScreenState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthenticatedUser }

type FormErrors = {
  email?: string[]
  password?: string[]
  form?: string
}

const apiClient = new ApiClient(
  import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:8000`,
)

function LoginPage({ onAuthenticated }: { onAuthenticated: (user: AuthenticatedUser) => void }) {
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
          <CardTitle className="text-2xl">Sign in to IoT OS</CardTitle>
          <CardDescription>
            Use your platform account to manage organizations and devices.
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
                  Your organization memberships will be loaded after sign in.
                </FieldDescription>
              </Field>
              <FieldError errors={errors.form ? [{ message: errors.form }] : undefined} />
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

function SessionHome({ user, onSignedOut }: { user: AuthenticatedUser; onSignedOut: () => void }) {
  async function signOut() {
    await apiClient.logout()
    onSignedOut()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Welcome back, {user.name}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-medium">Your organizations</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {user.organizations.map((organization) => (
                <li className="rounded-md border bg-background px-3 py-2 text-sm" key={organization.uuid}>
                  {organization.name}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}

export function App() {
  const [screen, setScreen] = useState<ScreenState>({ status: "loading" })

  useEffect(() => {
    let active = true

    apiClient
      .me()
      .then((user) => {
        if (active) setScreen({ status: "signed-in", user })
      })
      .catch(() => {
        if (active) setScreen({ status: "signed-out" })
      })

    return () => {
      active = false
    }
  }, [])

  if (screen.status === "loading") {
    return <main className="flex min-h-svh items-center justify-center text-muted-foreground">Loading…</main>
  }

  if (screen.status === "signed-in") {
    return <SessionHome user={screen.user} onSignedOut={() => setScreen({ status: "signed-out" })} />
  }

  return <LoginPage onAuthenticated={(user) => setScreen({ status: "signed-in", user })} />
}
