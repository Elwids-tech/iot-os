import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AuthenticatedUser, TwoStepSetup as Setup } from "@iot-os/api-client"
import { ConfirmationCancelled, useConfirmedAction } from "@iot-os/auth/ConfirmIdentityDialog"
import { passkeysSupported } from "@iot-os/auth/passkeys"
import { TwoStepSetup } from "@iot-os/auth/TwoStepSetup"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { ThemePicker } from "@iot-os/ui/components/theme-picker"
import { CpuIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"
import { LoadError } from "../components/forms"
import { api, apiBaseUrl } from "../lib/api"
import { adminUrl } from "../lib/admin"
import { clearPersonalState } from "../pwa/personal-state"
import { unsubscribeHere } from "../pwa/push"
import { requirementText } from "./requirement"
import { returnTarget } from "./returnTo"
import { AddPasskeyDialog, securityKey } from "./SecurityPage"

/**
 * Required two-step sign-in that is not set up yet (spec 034, US3, FR-022): the person
 * sees only setup and sign-out. Every other request is refused by the API until setup is
 * confirmed; then this returns to the page that was refused, in the portal, the admin app
 * or an agent's consent page.
 */
export default function SetupRequiredPage() {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const security = useQuery({ queryKey: securityKey, queryFn: () => api.security() })
  const confirmed = useConfirmedAction(api)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [starting, setStarting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [addingPasskey, setAddingPasskey] = useState(false)

  async function start() {
    setStarting(true)
    try {
      setSetup(await confirmed.run(() => api.startTwoStep()))
    } catch (error) {
      if (!(error instanceof ConfirmationCancelled)) toast.error("Two-step setup could not start. Please try again.")
    } finally {
      setStarting(false)
    }
  }

  function continueOn() {
    const target = returnTarget(params.get("return"), { admin: adminUrl, api: apiBaseUrl })
    // The session no longer asks for setup, and pages refused before it load again.
    cache.setQueryData<AuthenticatedUser>(["session"], (user) => user && { ...user, two_step_setup_required: false })
    void cache.invalidateQueries()
    if (target.kind === "external") window.location.assign(target.url)
    else navigate(target.path, { replace: true })
  }

  async function signOut() {
    setSigningOut(true)
    await api.logout().catch(() => {})
    api.setSelectedOrganizationUuid(null)
    // As every sign-out does: push stops here and nothing kept for this person stays (spec 033).
    await unsubscribeHere()
    await clearPersonalState(cache)
    navigate("/", { replace: true })
  }

  const why = security.data ? requirementText(security.data.two_step.required_by) : null
  // A passkey satisfies the requirement too, where the deployment and browser can use one.
  const passkeyOffered = Boolean(security.data?.passkeys?.available) && passkeysSupported()
  // While the recovery codes are on screen, setup is not finished for the person.
  const satisfied = (security.data?.two_step.satisfied ?? false) && setup === null

  return (
    <main className="flex min-h-svh items-center justify-center p-5 max-md:px-4">
      <Card className="w-full max-w-lg max-md:rounded-none max-md:bg-transparent max-md:shadow-none max-md:[&_[data-slot=card-footer]]:border-0 max-md:[&_[data-slot=card-footer]]:bg-transparent">
        <CardHeader>
          <div className="mb-4 flex items-center justify-between">
            <CpuIcon className="text-primary" />
            <ThemePicker />
          </div>
          <CardTitle>
            <h1>{satisfied ? "Two-step sign-in is on" : "Set up two-step sign-in"}</h1>
          </CardTitle>
          <CardDescription>
            {satisfied
              ? "You can continue where you were."
              : `${why ?? "Your account needs two-step sign-in."} Set it up to continue: after your password, signing in will also ask for a code from your phone.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {security.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : security.error ? (
            <LoadError error={security.error} what="your security settings" onRetry={() => security.refetch()} />
          ) : setup ? (
            <TwoStepSetup
              apiClient={api}
              setup={setup}
              onEnabled={() => void cache.invalidateQueries({ queryKey: securityKey })}
              onCancel={() => setSetup(null)}
              onDone={() => {
                toast.success("Two-step sign-in is on")
                continueOn()
              }}
            />
          ) : satisfied ? (
            <ShieldCheckIcon aria-hidden className="size-8 text-primary" />
          ) : (
            <p className="text-body text-muted-foreground">
              You need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or
              1Password. It takes about a minute.{passkeyOffered && " Or add a passkey: your fingerprint, face or screen lock."}
            </p>
          )}
        </CardContent>
        {!setup && (
          <CardFooter className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => void signOut()} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
            {satisfied ? (
              <Button onClick={continueOn}>Continue</Button>
            ) : (
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                {passkeyOffered && (
                  <Button variant="outline" onClick={() => setAddingPasskey(true)} disabled={starting}>
                    Add a passkey instead
                  </Button>
                )}
                <Button onClick={() => void start()} disabled={starting || security.isPending || Boolean(security.error)}>
                  {starting ? "Starting…" : "Set up"}
                </Button>
              </div>
            )}
          </CardFooter>
        )}
      </Card>
      <AddPasskeyDialog
        open={addingPasskey}
        run={confirmed.run}
        onClose={() => setAddingPasskey(false)}
        onAdded={async () => {
          setAddingPasskey(false)
          toast.success("Passkey added")
          continueOn()
        }}
      />
      {confirmed.dialog}
    </main>
  )
}
