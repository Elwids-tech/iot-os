import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { SecuritySettings, TwoStepSetup as Setup } from "@iot-os/api-client"
import { ConfirmationCancelled, useConfirmedAction } from "@iot-os/auth/ConfirmIdentityDialog"
import { RecoveryCodes } from "@iot-os/auth/RecoveryCodes"
import { TwoStepSetup } from "@iot-os/auth/TwoStepSetup"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { SettingsPage } from "@iot-os/ui/templates/settings-page"
import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { Confirm, LoadError } from "../components/forms"
import { api } from "../lib/api"
import { requirementText } from "./requirement"

export const securityKey = ["me", "security"] as const

const sections = [{ key: "security", label: "Security", to: "/account/security", current: true, icon: <KeyRoundIcon /> }]

/**
 * The person's own sign-in security (spec 034, US1): two-step sign-in with an
 * authenticator app and its recovery codes. Every change asks for the password again
 * when the last confirmation is over 15 minutes old.
 */
export default function SecurityPage() {
  const cache = useQueryClient()
  const security = useQuery({ queryKey: securityKey, queryFn: () => api.security() })
  const confirmed = useConfirmedAction(api)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [turningOff, setTurningOff] = useState(false)
  const [busy, setBusy] = useState<"setup" | "codes" | null>(null)
  const refresh = () => cache.invalidateQueries({ queryKey: securityKey })

  async function attempt<T>(what: "setup" | "codes", action: () => Promise<T>, done: (result: T) => void) {
    setBusy(what)
    try {
      done(await confirmed.run(action))
    } catch (error) {
      if (!(error instanceof ConfirmationCancelled)) toast.error(what === "setup" ? "Two-step setup could not start. Please try again." : "New recovery codes could not be made. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsPage title="Account" sections={sections}>
      <div className="flex max-w-form flex-col gap-(--panel-gap)">
        <h2 className="text-title">Security</h2>
        {security.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : security.error ? (
          <LoadError error={security.error} what="your security settings" onRetry={() => security.refetch()} />
        ) : (
          <>
            <AuthenticatorPanel
              twoStep={security.data.two_step}
              busy={busy === "setup"}
              onSetUp={() => attempt("setup", () => api.startTwoStep(), setSetup)}
              onTurnOff={() => setTurningOff(true)}
            />
            {security.data.two_step.enabled && (
              <RecoveryCodesPanel
                remaining={security.data.two_step.recovery_codes_remaining}
                busy={busy === "codes"}
                onRegenerate={() => attempt("codes", () => api.regenerateRecoveryCodes(), (fresh) => {
                  setCodes(fresh)
                  void refresh()
                })}
              />
            )}
          </>
        )}
      </div>

      <Dialog open={setup !== null} onOpenChange={(open) => !open && setSetup(null)}>
        <DialogContent
          className="sm:max-w-lg"
          // Closing by accident would lose the recovery codes: only the dialog's own buttons close it.
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Set up two-step sign-in</DialogTitle>
            <DialogDescription>After your password, signing in will also ask for a code from your phone.</DialogDescription>
          </DialogHeader>
          {setup && (
            <TwoStepSetup
              apiClient={api}
              setup={setup}
              onEnabled={() => void refresh()}
              onCancel={() => setSetup(null)}
              onDone={() => {
                setSetup(null)
                toast.success("Two-step sign-in is on")
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={codes !== null} onOpenChange={(open) => !open && setCodes(null)}>
        <DialogContent className="sm:max-w-lg" onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>New recovery codes</DialogTitle>
            <DialogDescription>Your earlier recovery codes no longer work.</DialogDescription>
          </DialogHeader>
          {codes && (
            <RecoveryCodes
              codes={codes}
              onDone={() => {
                setCodes(null)
                toast.success("New recovery codes saved")
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Confirm
        open={turningOff}
        title="Turn off two-step sign-in?"
        description="Signing in will ask only for your password, your recovery codes stop working, and you are signed out on your other devices."
        action="Turn off"
        onClose={() => setTurningOff(false)}
        onConfirm={async () => {
          try {
            await confirmed.run(() => api.disableTwoStep())
          } catch (error) {
            if (error instanceof ConfirmationCancelled) return setTurningOff(false)
            throw error
          }
          setTurningOff(false)
          await refresh()
          toast.success("Two-step sign-in is off")
        }}
      />
      {confirmed.dialog}
    </SettingsPage>
  )
}

function AuthenticatorPanel({
  twoStep,
  busy,
  onSetUp,
  onTurnOff,
}: {
  twoStep: SecuritySettings["two_step"]
  busy: boolean
  onSetUp: () => void
  onTurnOff: () => void
}) {
  const why = twoStep.required ? requirementText(twoStep.required_by) : null
  return (
    <Panel aria-labelledby="security-authenticator">
      <PanelHeader>
        <PanelTitle id="security-authenticator">Two-step sign-in</PanelTitle>
        <PanelActions>
          <Status value={twoStep.enabled ? "enabled" : "not_set_up"} />
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <p className="text-body text-muted-foreground">
          After your password, ask for a six-digit code from an authenticator app on your phone. Someone who learns
          your password still cannot sign in without it.
        </p>
        {why && (
          <p className="text-body" data-testid="two-step-required-by">
            {why}
            {twoStep.enabled && " It cannot be turned off."}
          </p>
        )}
        {twoStep.enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body">
              Authenticator app, turned on <RelativeTime at={twoStep.confirmed_at} />
            </p>
            {/* Required two-step stays on (FR-023); the sentence above says why. */}
            {!twoStep.required && (
              <Button variant="outline" onClick={onTurnOff}>
                Turn off
              </Button>
            )}
          </div>
        ) : (
          <Button className="w-fit" onClick={onSetUp} disabled={busy}>
            {busy ? "Starting…" : "Set up"}
          </Button>
        )}
      </PanelContent>
    </Panel>
  )
}

function RecoveryCodesPanel({ remaining, busy, onRegenerate }: { remaining: number; busy: boolean; onRegenerate: () => void }) {
  return (
    <Panel aria-labelledby="security-recovery-codes">
      <PanelHeader>
        <PanelTitle id="security-recovery-codes">Recovery codes</PanelTitle>
        <PanelDescription>Each signs you in once when you can't use your phone.</PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        {remaining === 0 ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>No recovery codes left</AlertTitle>
            <AlertDescription>Make new ones, so you can still sign in if you lose your phone.</AlertDescription>
          </Alert>
        ) : (
          <p className="text-body" data-testid="recovery-codes-remaining">
            {remaining} of 8 left
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-meta text-muted-foreground">Making new codes stops every earlier code from working.</p>
          <Button variant="outline" onClick={onRegenerate} disabled={busy}>
            {busy ? "Making codes…" : "Make new codes"}
          </Button>
        </div>
      </PanelContent>
    </Panel>
  )
}
