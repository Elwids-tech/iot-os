import { FormEvent, useEffect, useState } from "react"
import type { Organization, OrganizationRole } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { SelectField } from "@iot-os/ui/components/form-fields"
import { Input } from "@iot-os/ui/components/input"
import { AlertCircleIcon, SendIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

type FormErrors = {
  email?: string[]
  role_ids?: string[]
  form?: string
}

type InviteUserDialogProps = {
  organizations: Organization[]
  /** Selected when the dialog opens, and listed even if `organizations` has not caught up with it. */
  initialOrganization?: Organization
  onInvited: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InviteUserDialog({
  organizations,
  initialOrganization,
  onInvited,
  open,
  onOpenChange,
}: InviteUserDialogProps) {
  const [email, setEmail] = useState("")
  const [organizationUuid, setOrganizationUuid] = useState("")
  const [roles, setRoles] = useState<OrganizationRole[]>([])
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<FormErrors>({})
  const [isLoadingRoles, setIsLoadingRoles] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const choices =
    initialOrganization && !organizations.some((organization) => organization.uuid === initialOrganization.uuid)
      ? [initialOrganization, ...organizations]
      : organizations

  useEffect(() => {
    if (open) setOrganizationUuid(initialOrganization?.uuid ?? "")
  }, [open, initialOrganization?.uuid])

  useEffect(() => {
    let active = true

    if (!organizationUuid) {
      setRoles([])
      setSelectedRoleIds(new Set())
      setIsLoadingRoles(false)
      return () => {
        active = false
      }
    }

    setIsLoadingRoles(true)
    setSelectedRoleIds(new Set())

    apiClient
      .adminOrganizationRoles(organizationUuid)
      .then((data) => {
        if (active) setRoles(data)
      })
      .catch(() => {
        if (active) {
          setRoles([])
          setErrors((current) => ({ ...current, form: "Could not load roles for this organization." }))
        }
      })
      .finally(() => {
        if (active) setIsLoadingRoles(false)
      })

    return () => {
      active = false
    }
  }, [organizationUuid])

  function reset() {
    setEmail("")
    setOrganizationUuid("")
    setRoles([])
    setSelectedRoleIds(new Set())
    setErrors({})
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  function toggleRole(roleId: number, checked: boolean) {
    setSelectedRoleIds((current) => {
      const next = new Set(current)

      if (checked) {
        next.add(roleId)
      } else {
        next.delete(roleId)
      }

      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})

    if (!organizationUuid || selectedRoleIds.size === 0) {
      setErrors({ role_ids: ["Select an organization and at least one role."] })
      return
    }

    setIsSubmitting(true)

    try {
      const invitation = await apiClient.inviteUser(organizationUuid, email, [...selectedRoleIds])
      toast.success(`Invitation sent to ${invitation.email}`)
      handleOpenChange(false)
      onInvited()
    } catch (error) {
      const fields = validationErrors(error)
      const emailErrors = fieldMessages(fields, "email")
      const roleErrors = fieldMessages(fields, "role_ids")
      setErrors({
        email: emailErrors,
        role_ids: roleErrors,
        form: emailErrors || roleErrors ? undefined : errorMessage(error),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>They choose a password when they accept.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.email?.length)}>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input
                id="invite-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(errors.email?.length)}
                required
              />
              <FieldError errors={errors.email?.map((message) => ({ message }))} />
            </Field>
            <SelectField
              id="invite-organization"
              label="Organization"
              value={organizationUuid}
              onChange={setOrganizationUuid}
              placeholder="Select an organization"
              options={choices.map((organization) => ({
                value: organization.uuid,
                label: organization.name,
              }))}
            />
            <FieldSet data-invalid={Boolean(errors.role_ids?.length)}>
              <FieldLegend variant="label">Roles</FieldLegend>
              {!organizationUuid ? (
                <p className="text-sm text-muted-foreground">Select an organization to load its roles.</p>
              ) : isLoadingRoles ? (
                <p className="text-sm text-muted-foreground">Loading organization roles…</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {roles.map((role) => {
                    const id = `invite-role-${role.id}`

                    return (
                      <Field key={role.id} orientation="horizontal">
                        <Checkbox
                          id={id}
                          checked={selectedRoleIds.has(role.id)}
                          disabled={isSubmitting}
                          onCheckedChange={(checked) => toggleRole(role.id, checked === true)}
                        />
                        <FieldLabel htmlFor={id}>{role.display_name}</FieldLabel>
                      </Field>
                    )
                  })}
                </div>
              )}
              <FieldError errors={errors.role_ids?.map((message) => ({ message }))} />
            </FieldSet>
            {errors.form ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Invitation not sent</AlertTitle>
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isLoadingRoles}>
              <SendIcon data-icon="inline-start" />
              {isSubmitting ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
