import { type FormEvent, type ReactNode, useState } from "react"
import { ApiError, type ApiClient, type AuthenticatedUser, type TwoStepMethod, type TwoStepRefusal } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { SixDigitCode } from "@iot-os/ui/components/input-otp"
import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react"
import { PasskeySignInButton } from "./PasskeySignInButton"

type Answer = "code" | "recovery_code"

type Problem =
  | { kind: "refused"; field: Answer; message: string; attemptsLeft: number | null }
  | { kind: "start_again"; message: string }
  | { kind: "form"; message: string }

const title = "Enter your code"
const description = "Open your authenticator app and enter the six-digit code it shows for this account."
const recoveryDescription = "Enter one of the recovery codes you saved when you turned on two-step sign-in. Each code works once."

/**
 * The second step of sign-in (spec 034, FR-007 to FR-011): a code from the authenticator
 * app, or a recovery code. It shows only the methods the password step offered.
 *
 * - A wrong answer says how many tries are left; after five, or five minutes, the person
 *   starts again with their password (`onStartAgain`).
 * - After a recovery code it says how many are left before continuing; with none left it
 *   points to the security page (`securityHref`) to make new ones.
 *
 * - When the person has a passkey (`passkey` in `methods`), it also offers that; alone,
 *   as **Continue with your passkey**, when it is the only method. `remember` carries
 *   **Keep me signed in** from the password step.
 *
 * `variant` places it in a sign-in card or in the portal's session dialog.
 */
export function TwoStepChallenge({
  apiClient,
  methods,
  onSignedIn,
  onStartAgain,
  securityHref,
  variant = "card",
  top,
  remember = false,
}: {
  apiClient: ApiClient
  methods: TwoStepMethod[]
  /** The Keep me signed in choice from the password step, for a passkey sign-in. */
  remember?: boolean
  onSignedIn: (user: AuthenticatedUser) => void
  onStartAgain: () => void
  securityHref: string
  variant?: "card" | "dialog"
  /** A row above the card title, such as the app mark and theme picker. */
  top?: ReactNode
}) {
  const offersCode = methods.includes("code")
  const offersRecovery = methods.includes("recovery_code")
  const offersPasskey = methods.includes("passkey")
  const [mode, setMode] = useState<Answer>(offersCode ? "code" : "recovery_code")
  const [code, setCode] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [problem, setProblem] = useState<Problem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [finished, setFinished] = useState<{ user: AuthenticatedUser; remaining: number } | null>(null)

  async function answer(value: string) {
    if (submitting) return
    setSubmitting(true)
    setProblem(null)
    try {
      const result = await apiClient.twoStepChallenge(mode === "code" ? { code: value } : { recoveryCode: value })
      if (result.recoveryCodesRemaining === null) onSignedIn(result.user)
      else setFinished({ user: result.user, remaining: result.recoveryCodesRemaining })
    } catch (error) {
      setProblem(problemOf(error, mode))
      setCode("")
    } finally {
      setSubmitting(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = mode === "code" ? code : recoveryCode.trim()
    if (mode === "code" && value.length < 6) {
      setProblem({ kind: "refused", field: "code", message: "Enter all six digits.", attemptsLeft: null })
      return
    }
    void answer(value)
  }

  function switchTo(next: Answer) {
    setMode(next)
    setProblem((current) => (current?.kind === "refused" ? null : current))
  }

  const Header = variant === "card" ? CardHeader : DialogHeader
  const Title = variant === "card" ? CardTitle : DialogTitle
  const Description = variant === "card" ? CardDescription : DialogDescription
  const Footer = variant === "card" ? CardFooter : DialogFooter
  const Body = variant === "card" ? CardContent : "div"

  if (finished) {
    const none = finished.remaining === 0
    return (
      <>
        <Header>
          {top}
          <Title>{variant === "card" ? <h1>Signed in</h1> : "Signed in"}</Title>
          <Description>That recovery code no longer works.</Description>
        </Header>
        <Body>
          <Alert variant={none ? "destructive" : "default"}>
            {none ? <TriangleAlertIcon /> : <CheckCircle2Icon />}
            <AlertTitle>
              {none ? "You have no recovery codes left" : `${finished.remaining} recovery ${finished.remaining === 1 ? "code" : "codes"} left`}
            </AlertTitle>
            <AlertDescription>
              {none
                ? "Make new ones now, so you can still sign in if you lose your phone."
                : "Make new ones in Account → Security when you are running low."}
            </AlertDescription>
          </Alert>
        </Body>
        <Footer className={variant === "card" ? "flex flex-col items-stretch gap-3" : undefined}>
          {none && (
            <Button asChild>
              <a href={securityHref}>Make new recovery codes</a>
            </Button>
          )}
          <Button variant={none ? "outline" : "default"} onClick={() => onSignedIn(finished.user)}>
            Continue
          </Button>
        </Footer>
      </>
    )
  }

  if (problem?.kind === "start_again")
    return (
      <>
        <Header>
          {top}
          <Title>{variant === "card" ? <h1>Start again</h1> : "Start again"}</Title>
          <Description>{problem.message}</Description>
        </Header>
        <Body>
          <p className="text-body text-muted-foreground">
            For your security, a sign-in waits five minutes and five tries for its code. Enter your password again to get a new one.
          </p>
        </Body>
        <Footer className={variant === "card" ? "flex flex-col items-stretch" : undefined}>
          <Button onClick={onStartAgain}>Start again</Button>
        </Footer>
      </>
    )

  // A required person whose only second step is a passkey (FR-022).
  if (offersPasskey && !offersCode && !offersRecovery)
    return (
      <>
        <Header>
          {top}
          <Title>{variant === "card" ? <h1>Continue with your passkey</h1> : "Continue with your passkey"}</Title>
          <Description>Your password was right. Use your passkey to finish signing in.</Description>
        </Header>
        <Body>
          <PasskeySignInButton
            apiClient={apiClient}
            remember={() => remember}
            onSignedIn={onSignedIn}
            label="Continue with your passkey"
            variant="default"
          />
        </Body>
        <Footer className={variant === "card" ? "flex flex-col items-stretch" : undefined}>
          <Button type="button" variant="ghost" onClick={onStartAgain}>
            Back to password
          </Button>
        </Footer>
      </>
    )

  const refused = problem?.kind === "refused" && problem.field === mode ? problem : null
  const refusedMessage = refused
    ? refused.attemptsLeft === null
      ? refused.message
      : `${refused.message} ${refused.attemptsLeft} ${refused.attemptsLeft === 1 ? "try" : "tries"} left.`
    : null

  return (
    <>
      <Header>
        {top}
        <Title>{variant === "card" ? <h1>{title}</h1> : title}</Title>
        <Description>{mode === "code" ? description : recoveryDescription}</Description>
      </Header>
      <form onSubmit={submit} noValidate>
        <Body>
          <FieldGroup>
            {mode === "code" ? (
              <Field data-invalid={Boolean(refused) || undefined}>
                <FieldLabel htmlFor="two-step-code">Code from your authenticator app</FieldLabel>
                <SixDigitCode
                  id="two-step-code"
                  value={code}
                  onChange={(value) => {
                    setCode(value)
                    if (refused) setProblem(null)
                  }}
                  onComplete={(value) => void answer(value)}
                  invalid={Boolean(refused)}
                  autoFocus
                  aria-describedby={refused ? "two-step-code-error" : undefined}
                />
                <FieldError id="two-step-code-error" errors={refusedMessage ? [{ message: refusedMessage }] : undefined} />
              </Field>
            ) : (
              <Field data-invalid={Boolean(refused) || undefined}>
                <FieldLabel htmlFor="two-step-recovery-code">Recovery code</FieldLabel>
                <Input
                  id="two-step-recovery-code"
                  className="font-mono"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  maxLength={64}
                  required
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  aria-invalid={Boolean(refused) || undefined}
                  aria-describedby={refused ? "two-step-recovery-code-error" : "two-step-recovery-code-help"}
                />
                {refusedMessage ? (
                  <FieldError id="two-step-recovery-code-error" errors={[{ message: refusedMessage }]} />
                ) : (
                  <FieldDescription id="two-step-recovery-code-help">It looks like abcde12345-fghij67890.</FieldDescription>
                )}
              </Field>
            )}
            {problem?.kind === "form" && <FieldError errors={[{ message: problem.message }]} />}
            {offersCode && offersRecovery && (
              <Button
                type="button"
                variant="link"
                className="h-auto w-fit p-0 max-md:min-h-11"
                onClick={() => switchTo(mode === "code" ? "recovery_code" : "code")}
              >
                {mode === "code" ? "Use a recovery code" : "Use your authenticator app"}
              </Button>
            )}
            {offersPasskey && (
              <PasskeySignInButton
                apiClient={apiClient}
                remember={() => remember}
                onSignedIn={onSignedIn}
                label="Use a passkey instead"
              />
            )}
          </FieldGroup>
        </Body>
        <Footer className={variant === "card" ? "flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:justify-between" : "mt-5"}>
          <Button type="button" variant="ghost" onClick={onStartAgain} disabled={submitting}>
            Back to password
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Checking…" : "Verify"}
          </Button>
        </Footer>
      </form>
    </>
  )
}

function problemOf(error: unknown, mode: Answer): Problem {
  if (error instanceof ApiError && error.status === 422) {
    const refusal = error.payload as Partial<TwoStepRefusal> | null
    const errors = refusal?.errors ?? {}
    if (errors.pending?.length) return { kind: "start_again", message: errors.pending[0] }
    const field: Answer = errors.recovery_code?.length ? "recovery_code" : errors.code?.length ? "code" : mode
    const message = errors[field]?.[0] ?? refusal?.message ?? "That code is not valid."
    return { kind: "refused", field, message, attemptsLeft: refusal?.attempts_left ?? null }
  }
  if (error instanceof ApiError && error.status === 429) {
    const payload = error.payload as { message?: string } | null
    return { kind: "form", message: payload?.message ?? "Too many attempts. Wait a minute and try again." }
  }
  if (error instanceof ApiError && error.status === 0)
    return { kind: "form", message: "You are offline. Check your connection and try again." }
  return { kind: "form", message: "We could not check that code. Please try again." }
}
