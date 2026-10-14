import { FormEvent, useEffect, useState } from "react"
import {
  ApiError,
  type Organization,
  type OrganizationDeletion,
  type OrganizationDeletionEntry,
} from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
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
import { TextField } from "@iot-os/ui/components/form-fields"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

type Check =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: OrganizationDeletion }

function EntryList({ entries, label }: { entries: OrganizationDeletionEntry[]; label: string }) {
  return (
    <dl aria-label={label} className="flex flex-col divide-y rounded-md border text-sm">
      {entries.map((entry) => (
        <div key={entry.key} className="flex items-center justify-between gap-4 px-3 py-2">
          <dt>{entry.label}</dt>
          <dd className="tabular-nums text-muted-foreground">{entry.count.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Permanent deletion of an organization (spec 006). Organizations with devices or other
 * work show what blocks them; empty ones list what goes and need their slug typed.
 */
export function DeleteOrganizationDialog({
  organization,
  onClose,
  onDeleted,
}: {
  organization: Organization | null
  onClose: () => void
  onDeleted: () => void
}) {
  const [check, setCheck] = useState<Check>({ status: "loading" })
  const [typed, setTyped] = useState("")
  const [slugError, setSlugError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!organization) return
    let active = true
    setCheck({ status: "loading" })
    setTyped("")
    setSlugError(undefined)
    setFormError(null)

    apiClient
      .adminOrganizationDeletion(organization.uuid)
      .then((data) => {
        if (active) setCheck({ status: "ready", data })
      })
      .catch((error) => {
        if (active) setCheck({ status: "error", message: errorMessage(error) })
      })

    return () => {
      active = false
    }
  }, [organization])

  function close() {
    if (!busy) onClose()
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organization || check.status !== "ready" || typed !== check.data.organization.slug) return
    setSlugError(undefined)
    setFormError(null)
    setBusy(true)

    try {
      await apiClient.deleteAdminOrganization(organization.uuid, typed)
      toast.success(`${organization.name} deleted`)
      onDeleted()
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Something that blocks deletion appeared since the dialog opened.
        const blockers = (error.payload as { blockers?: OrganizationDeletionEntry[] } | null)?.blockers ?? []
        setCheck({ status: "ready", data: { ...check.data, deletable: false, blockers } })
      } else if (error instanceof ApiError && error.status === 404) {
        toast.info(`${organization.name} was already deleted`)
        onDeleted()
        onClose()
      } else {
        const message = fieldMessages(validationErrors(error), "slug")?.[0]
        setSlugError(message)
        setFormError(message ? null : errorMessage(error))
      }
    } finally {
      setBusy(false)
    }
  }

  const name = organization?.name ?? "this organization"
  const data = check.status === "ready" ? check.data : null
  const blocked = data !== null && !data.deletable

  return (
    <AlertDialog open={organization !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <form onSubmit={remove} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{blocked ? `${name} can't be deleted yet` : `Delete ${name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {check.status === "loading"
                ? "Checking what this organization holds…"
                : blocked
                  ? "Only organizations without devices or other work can be deleted. Remove these first:"
                  : "This permanently deletes the organization and cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {check.status === "loading" ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : check.status === "error" ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>Could not check this organization. {check.message}</AlertDescription>
            </Alert>
          ) : blocked ? (
            <EntryList entries={data.blockers} label="What blocks deletion" />
          ) : data ? (
            <>
              {data.removes.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">Also removed:</p>
                  <EntryList entries={data.removes} label="What deletion removes" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">It holds nothing else.</p>
              )}
              <TextField
                id="delete-organization-slug"
                label={
                  <>
                    Type <span className="font-mono">{data.organization.slug}</span> to confirm
                  </>
                }
                value={typed}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                disabled={busy}
                error={slugError}
                onChange={(event) => setTyped(event.target.value)}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
            </>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>
              {blocked || check.status === "error" ? "Close" : "Cancel"}
            </AlertDialogCancel>
            {data && !blocked ? (
              <Button type="submit" variant="destructive" disabled={busy || typed !== data.organization.slug}>
                {busy ? "Deleting…" : "Delete organization"}
              </Button>
            ) : null}
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
