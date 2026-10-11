import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type { TenantRole } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import {
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
      <div className="flex flex-col gap-2">
        {roles.map((role) => {
          const locked = role.assignable === false
          return (
            <ChoiceCard
              key={role.id}
              type="checkbox"
              value={`role-${role.id}`}
              checked={value.includes(role.id)}
              disabled={disabled || locked}
              title={role.display_name}
              description={locked ? ROLE_NOT_ASSIGNABLE : roleSummary(role)}
              onCheckedChange={(next) =>
                onChange(next ? [...value, role.id] : value.filter((item) => item !== role.id))
              }
            />
          )
        })}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </FieldSet>
  )
}
