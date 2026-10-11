import { FormEvent, useEffect, useState } from "react"
import type { Organization, OrganizationRole, PlatformUser } from "@iot-os/api-client"
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
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { SelectField } from "@iot-os/ui/components/form-fields"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

export type MemberAction = { kind: "roles" | "remove"; user: PlatformUser }

// ponytail: the members API has no lookup by user, so this pages through (100 per page) until found.
async function memberRoleIds(organizationUuid: string, userId: number): Promise<number[]> {
  for (let page = 1; ; page++) {
    const result = await apiClient.organizationMembers(organizationUuid, page)
    const member = result.data.find((item) => item.id === userId)
    if (member) return member.roles.map((role) => role.id)
    if (page >= result.meta.last_page) return []
  }
}

function OrganizationChoice({
  organizations,
  value,
  onChange,
  disabled,
}: {
  organizations: Organization[]
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  if (organizations.length < 2) return null

  return (
    <SelectField
      id="member-organization"
      label="Organization"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={organizations.map((organization) => ({
        value: organization.uuid,
        label: organization.name,
      }))}
    />
  )
}

/** Change roles and Remove member for one user in one of their organizations. */
export function MemberDialogs({
  action,
  preferredOrganization,
  onClose,
  onRemoved,
}: {
  action: MemberAction | null
  preferredOrganization?: string
  onClose: () => void
  onRemoved: () => void
}) {
  const organizations = action?.user.organizations ?? []
  const [organizationUuid, setOrganizationUuid] = useState("")
  const [roles, setRoles] = useState<OrganizationRole[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [assigned, setAssigned] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const organization = organizations.find((item) => item.uuid === organizationUuid)
  const dirty =
    action?.kind === "roles" &&
    roles !== null &&
    (selected.size !== assigned.size || [...selected].some((id) => !assigned.has(id)))
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard role changes?",
    description: `The role changes for ${action?.user.name ?? "this member"} are not saved.`,
  })

  useEffect(() => {
    const orgs = action?.user.organizations ?? []
    setOrganizationUuid(
      orgs.find((item) => item.uuid === preferredOrganization)?.uuid ?? orgs[0]?.uuid ?? "",
    )
    setErrors(null)
    setFormError(null)
  }, [action, preferredOrganization])

  useEffect(() => {
    let active = true
    setRoles(null)
    setSelected(new Set())
    setAssigned(new Set())
    if (action?.kind !== "roles" || !organizationUuid) return

    Promise.all([
      apiClient.adminOrganizationRoles(organizationUuid),
      memberRoleIds(organizationUuid, action.user.id),
    ])
      .then(([available, current]) => {
        if (!active) return
        setRoles(available)
        setSelected(new Set(current))
        setAssigned(new Set(current))
      })
      .catch(() => {
        if (active) setFormError("Could not load roles for this organization.")
      })

    return () => {
      active = false
    }
  }, [action, organizationUuid])

  function close() {
    if (!busy) onClose()
  }

  function cancelRoles() {
    if (!busy) guard(onClose)
  }

  function failed(error: unknown, field: string) {
    const fields = validationErrors(error)
    setErrors(fields)
    setFormError(fieldMessages(fields, field) ? null : errorMessage(error))
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!action || !organization) return
    setErrors(null)
    setFormError(null)
    setBusy(true)

    try {
      await apiClient.syncOrganizationMemberRoles(organization.uuid, action.user.id, [...selected])
      toast.success(`Roles updated for ${action.user.name} in ${organization.name}`)
      onClose() // saved, so no discard prompt
    } catch (error) {
      failed(error, "role_ids")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!action || !organization) return
    setErrors(null)
    setFormError(null)
    setBusy(true)

    try {
      await apiClient.removeOrganizationMember(organization.uuid, action.user.id)
      toast.success(`${action.user.name} removed from ${organization.name}`)
      onRemoved()
      onClose()
    } catch (error) {
      failed(error, "member")
    } finally {
      setBusy(false)
    }
  }

  const roleErrors = fieldMessages(errors, "role_ids")
  const memberErrors = fieldMessages(errors, "member")
  const errorAlert = formError ? (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertDescription>{formError}</AlertDescription>
    </Alert>
  ) : null

  return (
    <>
      <Dialog open={action?.kind === "roles"} onOpenChange={(open) => !open && cancelRoles()}>
        <DialogContent showCloseButton={!busy} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Change roles for {action?.user.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveRoles}>
            <FieldGroup>
              <OrganizationChoice
                organizations={organizations}
                value={organizationUuid}
                onChange={(value) => guard(() => setOrganizationUuid(value))}
                disabled={busy}
              />
              <FieldSet data-invalid={Boolean(roleErrors)}>
                <FieldLegend variant="label">
                  Roles{organizations.length < 2 && organization ? ` in ${organization.name}` : ""}
                </FieldLegend>
                {roles === null && !formError ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading roles…
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {(roles ?? []).map((role) => {
                      const id = `member-role-${role.id}`
                      return (
                        <Field key={role.id} orientation="horizontal">
                          <Checkbox
                            id={id}
                            checked={selected.has(role.id)}
                            disabled={busy}
                            onCheckedChange={(checked) =>
                              setSelected((current) => {
                                const next = new Set(current)
                                if (checked === true) next.add(role.id)
                                else next.delete(role.id)
                                return next
                              })
                            }
                          />
                          <FieldLabel htmlFor={id}>{role.display_name}</FieldLabel>
                        </Field>
                      )
                    })}
                  </div>
                )}
                <FieldError errors={roleErrors?.map((message) => ({ message }))} />
              </FieldSet>
              {errorAlert}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancelRoles} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || roles === null || selected.size === 0}>
                {busy ? "Saving…" : "Save roles"}
              </Button>
            </DialogFooter>
            {roles !== null && selected.size === 0 ? (
              <p className="mt-2 text-right text-sm text-muted-foreground">
                Select at least one role, or remove the member instead.
              </p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={action?.kind === "remove"} onOpenChange={(open) => !open && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {action?.user.name}
              {organizations.length < 2 && organization ? ` from ${organization.name}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this organization. Their account and other memberships stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <OrganizationChoice
            organizations={organizations}
            value={organizationUuid}
            onChange={setOrganizationUuid}
            disabled={busy}
          />
          {memberErrors ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{memberErrors[0]}</AlertDescription>
            </Alert>
          ) : null}
          {errorAlert}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy || !organization} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove member"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {discardDialog}
    </>
  )
}
