import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ApiError, type OwnedBillingAccount } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { slugify } from "@iot-os/ui/lib/slug"
import { CircleAlertIcon } from "lucide-react"
import { fieldError, RequestError, TextField } from "../components/forms"
import { api } from "../lib/api"
import { billingAccountsKey } from "./model"

const NO_LONGER_OWNER = "You no longer own this billing account."

/**
 * An owner creates an organization under their billing account (spec 023) and becomes
 * its Organization Admin. The address follows the name until edited; untouched, the
 * server picks a free one.
 */
export function NewOrganizationDialog({ account, onClose }: { account: OwnedBillingAccount; onClose: () => void }) {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const status = error instanceof ApiError ? error.status : undefined
  const nameError = fieldError(error, "name")
  const slugError = fieldError(error, "slug")
  const limitError = fieldError(error, "billing_account")
  const otherError = status !== 404 && !nameError && !slugError && !limitError ? error : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const edited = slugTouched && slug.trim() !== ""
      const created = await api.createOwnedOrganization(account.uuid, {
        name: name.trim(),
        ...(edited ? { slug: slug.trim() } : {}),
      })
      // The session carries the new organization and its capabilities; the shell needs it before navigating.
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["session"] }),
        cache.invalidateQueries({ queryKey: billingAccountsKey }),
      ])
      toast.success(`${created.name} created`)
      onClose()
      navigate(`/organizations/${encodeURIComponent(created.uuid)}/home`)
    } catch (issue) {
      setError(issue)
      if (issue instanceof ApiError && (issue.status === 404 || issue.status === 422))
        void cache.invalidateQueries({ queryKey: billingAccountsKey })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>
            It belongs to {account.name}, and you become its Organization Admin.
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <TextField
              label="Name"
              value={name}
              required
              maxLength={255}
              autoComplete="off"
              disabled={busy}
              error={nameError}
              onChange={(event) => {
                setName(event.target.value)
                if (!slugTouched) setSlug(slugify(event.target.value))
              }}
            />
            <TextField
              label="Address"
              value={slug}
              maxLength={255}
              autoComplete="off"
              disabled={busy}
              help="A number is added if this address is taken."
              error={slugError}
              onChange={(event) => {
                setSlug(event.target.value)
                setSlugTouched(true)
              }}
            />
          </FieldGroup>
          {limitError || status === 404 ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{status === 404 ? NO_LONGER_OWNER : limitError}</AlertDescription>
            </Alert>
          ) : null}
          <RequestError error={otherError} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
