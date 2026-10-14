import { FormEvent, useEffect, useState } from "react"
import type { OrganizationRoleDetail } from "@iot-os/api-client"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { TextField } from "@iot-os/ui/components/form-fields"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

/**
 * Renames a role. The API replaces the name and the bundle together, so this sends the
 * role's saved permissions: unsaved ticks on the page stay unsaved.
 */
export function RenameRoleDialog({
  role,
  savedPermissionNames,
  open,
  onClose,
  onRenamed,
}: {
  role: OrganizationRoleDetail
  savedPermissionNames: ReadonlySet<string>
  open: boolean
  onClose: () => void
  onRenamed: (displayName: string) => void
}) {
  const [name, setName] = useState(role.display_name)
  const [nameError, setNameError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(role.display_name)
    setNameError(undefined)
    setFormError(null)
  }, [open, role.display_name])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNameError(undefined)
    setFormError(null)
    setBusy(true)

    try {
      const saved = await apiClient.updateOrganizationRole(role.organization.uuid, role.id, {
        display_name: name.trim(),
        permission_names: [...savedPermissionNames].sort(),
      })
      toast.success(`Renamed to ${saved.display_name}`)
      onRenamed(saved.display_name)
      onClose()
    } catch (error) {
      const message = fieldMessages(validationErrors(error), "display_name")?.[0]
      setNameError(message)
      setFormError(message ? null : errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Rename role</DialogTitle>
          <DialogDescription>
            Members and invitations keep this role; only its name changes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <TextField
              id="rename-role-name"
              label="Role name"
              value={name}
              maxLength={255}
              autoComplete="off"
              required
              disabled={busy}
              error={nameError}
              onChange={(event) => setName(event.target.value)}
            />
            {formError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === role.display_name}>
              {busy ? "Saving…" : "Rename role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Deletes a custom role; the API refuses while a member holds it or an open invitation uses it. */
export function DeleteRoleDialog({
  role,
  open,
  onClose,
  onDeleted,
}: {
  role: OrganizationRoleDetail
  open: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  async function remove() {
    setError(null)
    setBusy(true)

    try {
      await apiClient.deleteOrganizationRole(role.organization.uuid, role.id)
      toast.success(`${role.display_name} deleted`)
      onDeleted()
    } catch (reason) {
      setError(fieldMessages(validationErrors(reason), "role")?.[0] ?? errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {role.display_name}?</AlertDialogTitle>
          <AlertDialogDescription>
            It is removed from {role.organization.name}. Only roles that no member holds and no
            pending invitation uses can be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete role"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
