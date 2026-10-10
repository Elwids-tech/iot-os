import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type { TenantRole } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLegend,
  FieldSet,
} from "@iot-os/ui/components/field"
import { api } from "../lib/api"
import { ROLE_NOT_ASSIGNABLE, administrationOf, roleSummary, sortRoles } from "./model"

/** The current organization and what the signed-in user may do in its member and role screens. */
export function useAdministration() {
  const { organizationUuid = "" } = useParams()
  const session = useQuery({ queryKey: ["session"], queryFn: () => api.me(), staleTime: 60000 })
  const organization = session.data?.organizations.find((item) => item.uuid === organizationUuid)
  return { org: organizationUuid, organization, can: administrationOf(organization), session }
}

export function useRoles(org: string, enabled = true) {
  return useQuery({
    queryKey: ["roles", org],
    queryFn: () => api.organizationRoles(org),
    select: sortRoles,
    enabled,
  })
}

export function RoleBadges({ roles }: { roles: Array<{ id: number; display_name: string }> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role.id} variant="secondary">
          {role.display_name}
        </Badge>
      ))}
    </div>
  )
}

/** Pick one or more roles. Roles with permissions the actor lacks stay visible but locked. */
export function RoleChecklist({
  roles,
  value,
  onChange,
  disabled,
  error,
}: {
  roles: TenantRole[]
  value: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
  error?: string
}) {
  return (
    <FieldSet data-invalid={Boolean(error)}>
      <FieldLegend variant="label">Roles</FieldLegend>
      <FieldDescription>Members get every permission in each role they hold.</FieldDescription>
      <div className="flex flex-col divide-y rounded-md border">
        {roles.map((role) => {
          const id = `role-${role.id}`
          const locked = role.assignable === false
          const checked = value.includes(role.id)
          return (
            <Field key={role.id} orientation="horizontal" className="px-3 py-2.5 has-disabled:opacity-60">
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled || locked}
                aria-describedby={`${id}-summary`}
                onCheckedChange={(next) =>
                  onChange(next === true ? [...value, role.id] : value.filter((item) => item !== role.id))
                }
              />
              <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                <span className="font-medium">{role.display_name}</span>
                <span id={`${id}-summary`} className="text-xs text-muted-foreground">
                  {locked ? ROLE_NOT_ASSIGNABLE : roleSummary(role)}
                </span>
              </label>
            </Field>
          )
        })}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </FieldSet>
  )
}
