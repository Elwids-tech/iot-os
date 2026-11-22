import { FormEvent, useEffect, useState } from "react"
import { ApiError, type Branding, type PortalAddress } from "@iot-os/api-client"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { CopyButton } from "@iot-os/ui/components/copy-text"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@iot-os/ui/components/input-group"
import { formatDay } from "@iot-os/ui/lib/invoices"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"

type Account = { uuid: string; name: string }
type Editing = { kind: "name"; current: PortalAddress | null } | { kind: "domain" }

/** What the API says about a name, a domain or a check, as one sentence. */
function refusal(error: unknown): string {
  const code = error instanceof ApiError ? (error.payload as { code?: string } | null)?.code : undefined
  if (code === "checked_recently") return "Checked a moment ago. Try again in a minute."
  return errorMessage(error)
}

/**
 * Platform staff claim, rename, check and remove a billing account's portal addresses
 * on its owners' behalf (spec 036 US6): the same actions the owners have in the portal,
 * without the allowance check. Render `dialogs` once.
 */
export function useAddressEditing(account: Account, branding: Branding | null, onChanged: () => void) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [record, setRecord] = useState<PortalAddress | null>(null)
  const [removing, setRemoving] = useState<PortalAddress | null>(null)
  const [busy, setBusy] = useState(false)

  async function check(address: PortalAddress) {
    setBusy(true)
    try {
      const checked = await apiClient.checkPortalAddress(account.uuid, address.uuid, true)
      if (checked.state === "active") toast.success(`${checked.host} is active`)
      else toast.message(`The DNS record for ${checked.host} was not found`, { description: "It is checked again every few minutes." })
      onChanged()
    } catch (error) {
      toast.error(refusal(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await apiClient.releasePortalAddress(account.uuid, removing.uuid, true)
      toast.success(`${removing.host} removed`)
      setRemoving(null)
      onChanged()
    } catch (error) {
      toast.error(refusal(error))
    } finally {
      setBusy(false)
    }
  }

  const dialogs = (
    <>
      <AddressDialog
        account={account}
        editing={editing}
        suffix={branding?.name_suffix ?? ""}
        onClose={() => setEditing(null)}
        onSaved={(address) => {
          // A new domain shows its record at once: staff pass it on to the customer.
          if (address.kind === "domain" && address.record) setRecord(address)
          onChanged()
        }}
      />
      <Dialog open={record !== null} onOpenChange={(open) => !open && setRecord(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>DNS record for {record?.host}</DialogTitle>
            <DialogDescription>
              {record?.state === "waiting_dns"
                ? `The customer adds this record where they manage DNS for the domain. The portal opens there once it is found${
                    record.lapses_at ? `; the request lapses on ${formatDay(record.lapses_at)} if it is not.` : "."
                  }`
                : "The record that points the domain to the portal. It must stay in place."}
            </DialogDescription>
          </DialogHeader>
          {record?.record ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 rounded-md border bg-muted/40 p-3 text-sm" aria-label="DNS record">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-mono">{record.record.type}</dd>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 font-mono break-all">{record.record.name}</span>
                <CopyButton value={record.record.name} label="record name" />
              </dd>
              <dt className="text-muted-foreground">Value</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 font-mono break-all">{record.record.value}</span>
                <CopyButton value={record.record.value} label="record value" />
              </dd>
            </dl>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecord(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !busy && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.host}?</AlertDialogTitle>
            <AlertDialogDescription>
              The portal of {account.name} stops opening there within a minute, and people signed in there are signed out of it.{" "}
              {removing?.kind === "domain"
                ? "The domain can be added again later; it then needs a new DNS record."
                : "The name is held for 30 days, so no other account can take it and this one can claim it again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep address</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove address"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return {
    claimName: (current: PortalAddress | null) => setEditing({ kind: "name", current }),
    addDomain: () => setEditing({ kind: "domain" }),
    showRecord: setRecord,
    check,
    remove: setRemoving,
    busy,
    dialogs,
  }
}

/** Claims or changes the account's name, or asks for its custom domain. */
function AddressDialog({
  account,
  editing,
  suffix,
  onClose,
  onSaved,
}: {
  account: Account
  editing: Editing | null
  suffix: string
  onClose: () => void
  onSaved: (address: PortalAddress) => void
}) {
  const current = editing?.kind === "name" ? editing.current : null
  const held = current ? current.host.slice(0, current.host.length - suffix.length) : ""
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const entered = value.trim().toLowerCase()
  const dirty = editing !== null && entered !== held
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this address?",
    description: "Nothing is claimed or changed.",
  })

  useEffect(() => {
    setValue(held)
    setError(null)
  }, [editing])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || !dirty || entered === "") return
    setError(null)
    setSaving(true)
    try {
      const address =
        editing.kind === "name"
          ? await apiClient.claimPortalName(account.uuid, entered, true)
          : await apiClient.claimPortalDomain(account.uuid, entered, true)
      toast.success(
        editing.kind === "domain"
          ? `${address.host} added. It is waiting for its DNS record`
          : current
            ? `Name changed to ${address.host}`
            : `${address.host} claimed for ${account.name}`,
      )
      onSaved(address)
      onClose()
    } catch (failure) {
      setError(refusal(failure))
    } finally {
      setSaving(false)
    }
  }

  const name = editing?.kind === "name"

  return (
    <>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && !saving && guard(onClose)}>
        <DialogContent showCloseButton={!saving}>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{name ? (current ? "Change the name" : "Claim a name") : "Add a custom domain"}</DialogTitle>
              <DialogDescription>
                {name
                  ? `Where the people of ${account.name} open the portal under its brand.`
                  : `A subdomain ${account.name} controls. Next you get one DNS record for the customer to add.`}
              </DialogDescription>
            </DialogHeader>
            <Field data-invalid={error !== null}>
              <FieldLabel htmlFor="admin-portal-address">{name ? "Name" : "Domain"}</FieldLabel>
              {name ? (
                <InputGroup>
                  <InputGroupInput
                    id="admin-portal-address"
                    value={value}
                    onChange={(event) => {
                      setError(null)
                      setValue(event.target.value)
                    }}
                    placeholder="acme"
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={40}
                    aria-invalid={error !== null}
                    aria-describedby="admin-portal-address-help"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{suffix}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                <Input
                  id="admin-portal-address"
                  value={value}
                  onChange={(event) => {
                    setError(null)
                    setValue(event.target.value)
                  }}
                  placeholder="portal.example.org"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  maxLength={253}
                  aria-invalid={error !== null}
                  aria-describedby="admin-portal-address-help"
                />
              )}
              <FieldDescription id="admin-portal-address-help">
                {name
                  ? current
                    ? "3 to 40 letters, numbers and hyphens. The old name sends people to the new one for 30 days."
                    : "3 to 40 letters, numbers and hyphens."
                  : "A bare domain such as example.org cannot be used."}
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => guard(onClose)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!dirty || entered === "" || saving}>
                {saving ? "Saving…" : name ? (current ? "Change name" : "Claim name") : "Add domain"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
