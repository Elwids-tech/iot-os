import { type FormEvent, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { runtimeAddress, type Passkey, type SecuritySettings, type TwoStepSetup as Setup } from "@iot-os/api-client"
import { ConfirmationCancelled, useConfirmedAction } from "@iot-os/auth/ConfirmIdentityDialog"
import { addPasskey, passkeyProblem, passkeysSupported } from "@iot-os/auth/passkeys"
import { RecoveryCodes } from "@iot-os/auth/RecoveryCodes"
import { TwoStepSetup } from "@iot-os/auth/TwoStepSetup"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { TextField } from "@iot-os/ui/components/form-fields"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { SettingsPage } from "@iot-os/ui/templates/settings-page"
import { FingerprintIcon, InfoIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { Confirm, LoadError } from "../components/forms"
import { api } from "../lib/api"
import { requirementText } from "./requirement"

export const securityKey = ["me", "security"] as const

const sections = [{ key: "security", label: "Security", to: "/account/security", current: true, icon: <KeyRoundIcon /> }]

/**
 * The person's own sign-in security (spec 034, US1 and US2): two-step sign-in with an
 * authenticator app and its recovery codes, and passkeys. Every change asks for the
 * password, or a passkey, again when the last confirmation is over 15 minutes old.
 */
export default function SecurityPage() {
  const cache = useQueryClient()
  const security = useQuery({ queryKey: securityKey, queryFn: () => api.security() })
  const passkeys = security.data?.passkeys
  const confirmed = useConfirmedAction(api, { passkey: Boolean(passkeys?.available && passkeys.items.some((passkey) => passkey.usable_here)) })
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
            <PasskeysPanel passkeys={security.data.passkeys} run={confirmed.run} onChanged={refresh} />
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

/**
 * Passkeys (spec 034, US2, FR-016 to FR-019): sign in with the phone's or computer's
 * screen lock instead of a password and code. Adding or removing one asks for a recent
 * confirmation and emails the person; it does not sign out their other devices.
 */
function PasskeysPanel({
  passkeys,
  run,
  onChanged,
}: {
  passkeys: SecuritySettings["passkeys"]
  run: <T>(action: () => Promise<T>) => Promise<T>
  onChanged: () => Promise<unknown>
}) {
  const [supported] = useState(passkeysSupported)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Passkey | null>(null)
  const reason = !passkeys.available
    ? "Passkeys need this site to be served over HTTPS. Ask your administrator, and use two-step sign-in until then."
    : !supported
      ? "This browser does not support passkeys. Use another browser, or two-step sign-in."
      : null

  // Passkeys belong to the address they were made on (spec 036, FR-026). The column
  // appears only for a person who has one from somewhere else, or is on a custom domain.
  const onDomain = runtimeAddress()?.kind === "domain"
  const elsewhere = onDomain || passkeys.items.some((passkey) => !passkey.usable_here)
  const columns: DataColumn<Passkey>[] = [
    {
      id: "name",
      header: "Name",
      mobile: "title",
      hideable: false,
      value: (passkey) => passkey.name,
      cell: (passkey) => <span className="max-md:font-medium">{passkey.name}</span>,
    },
    ...(elsewhere
      ? [
          {
            id: "domain",
            header: "Works at",
            mobile: "meta",
            hideable: false,
            value: (passkey) => passkey.relying_party_id,
            cell: (passkey) => (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="break-all">{passkey.relying_party_id}</span>
                {passkey.usable_here ? null : <Badge variant="outline">Not this address</Badge>}
              </span>
            ),
          } satisfies DataColumn<Passkey>,
        ]
      : []),
    {
      id: "added",
      header: "Added",
      mobile: "meta",
      hideable: false,
      className: "text-muted-foreground",
      cell: (passkey) => <RelativeTime at={passkey.created_at} />,
    },
    {
      id: "used",
      header: "Last used",
      mobile: "meta",
      hideable: false,
      className: "text-muted-foreground",
      cell: (passkey) => <RelativeTime at={passkey.last_used_at} never="Not yet" />,
    },
    {
      id: "actions",
      header: "Actions",
      headerHidden: true,
      align: "end",
      hideable: false,
      cell: (passkey) => (
        <Button variant="outline" size="sm" onClick={() => setRemoving(passkey)} aria-label={`Remove ${passkey.name}`}>
          Remove
        </Button>
      ),
    },
  ]

  return (
    <Panel aria-labelledby="security-passkeys">
      <PanelHeader>
        <PanelTitle id="security-passkeys">Passkeys</PanelTitle>
        <PanelDescription>Sign in with your fingerprint, face or screen lock instead of a password and code.</PanelDescription>
        {!reason && (
          <PanelActions>
            <Button onClick={() => setAdding(true)}>Add a passkey</Button>
          </PanelActions>
        )}
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        {reason && (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Passkeys can't be used here</AlertTitle>
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
        )}
        {!reason && elsewhere && (
          <Alert>
            <InfoIcon />
            <AlertTitle>Passkeys work only at the address they were made on</AlertTitle>
            <AlertDescription>
              {passkeys.items.some((passkey) => !passkey.usable_here)
                ? "A passkey marked Not this address cannot sign you in here. Add one here to use a passkey at this address."
                : "A passkey you add here signs you in at this address only."}
            </AlertDescription>
          </Alert>
        )}
        {passkeys.items.length > 0 ? (
          <DataTable
            id="passkeys"
            label="Passkeys"
            noun={["passkey", "passkeys"]}
            rows={passkeys.items}
            rowKey={(passkey) => String(passkey.id)}
            rowLabel={(passkey) => passkey.name}
            columns={columns}
          />
        ) : (
          !reason && (
            <p className="flex items-center gap-2 text-body text-muted-foreground">
              <FingerprintIcon className="size-4 shrink-0" />
              {onDomain ? "No passkeys yet." : "No passkeys yet. A passkey works in both this app and the administration app."}
            </p>
          )
        )}
      </PanelContent>
      <AddPasskeyDialog
        open={adding}
        run={run}
        onClose={() => setAdding(false)}
        onAdded={async (name) => {
          setAdding(false)
          await onChanged()
          toast.success(`Passkey "${name}" added`)
        }}
      />
      <Confirm
        open={removing !== null}
        title={`Remove ${removing?.name ?? "this passkey"}?`}
        description="It will no longer sign you in. You can add it again later."
        action="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await run(() => api.removePasskey(removing.id))
          } catch (error) {
            if (error instanceof ConfirmationCancelled) return setRemoving(null)
            throw error
          }
          const name = removing.name
          setRemoving(null)
          await onChanged()
          toast.success(`Passkey "${name}" removed`)
        }}
      />
    </Panel>
  )
}

/** Name a new passkey, then run the browser's ceremony; also offered on the setup-required page. */
export function AddPasskeyDialog({
  open,
  run,
  onClose,
  onAdded,
}: {
  open: boolean
  run: <T>(action: () => Promise<T>) => Promise<T>
  onClose: () => void
  onAdded: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setProblem("Give the passkey a name of 1 to 60 characters.")
    setBusy(true)
    setProblem(null)
    try {
      await run(() => addPasskey(api, trimmed))
      setName("")
      await onAdded(trimmed)
    } catch (error) {
      if (!(error instanceof ConfirmationCancelled)) setProblem(passkeyProblem(error, "add"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          setProblem(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a passkey</DialogTitle>
          <DialogDescription>Name it after the device or key that holds it, then follow your browser's prompt.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <TextField
              label="Name"
              autoFocus
              maxLength={60}
              autoComplete="off"
              placeholder="MacBook Touch ID"
              help="1 to 60 characters. Only you see it."
              error={problem ?? undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FieldGroup>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Waiting for your passkey…" : "Add passkey"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

