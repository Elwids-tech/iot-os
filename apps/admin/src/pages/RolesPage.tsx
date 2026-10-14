import { useMemo } from "react"
import type { DirectoryQuery, OrganizationRole, PaginatedResponse } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { PlusIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useDirectoryTable } from "../components/ResourceDirectory"
import { useOrganizationOptions } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

function loadRoles(query: DirectoryQuery): Promise<PaginatedResponse<OrganizationRole>> {
  return apiClient.adminRoles(query)
}

export function RolesPage() {
  const organizations = useOrganizationOptions()
  const { query, table } = useDirectoryTable(loadRoles, { searchPlaceholder: "Role name or key", organizations })
  const columns = useMemo<DataColumn<OrganizationRole>[]>(
    () => [
      {
        id: "role",
        header: "Role",
        mobile: "title",
        value: (role) => role.display_name,
        cell: (role) => (
          <>
            <RowLink to={`/roles/${role.id}`}>{role.display_name}</RowLink>
            <span className="ml-2 font-mono text-meta text-muted-foreground">{role.key}</span>
          </>
        ),
      },
      { id: "organization", header: "Organization", value: (role) => role.organization.name, cell: (role) => role.organization.name },
      {
        id: "type",
        header: "Type",
        value: (role) => (role.is_default ? "Default" : "Custom"),
        cell: (role) => <span className="text-muted-foreground">{role.is_default ? "Default" : "Custom"}</span>,
      },
      {
        id: "permissions",
        header: "Permissions",
        align: "end",
        value: (role) => role.permissions_count,
        cell: (role) => <span className="tabular-nums">{role.permissions_count.toLocaleString()}</span>,
      },
    ],
    [],
  )

  return (
    <CollectionPage
      title="Roles"
      actions={
        <Button size="sm" asChild>
          <Link to={query.organization ? `/roles/new?organization=${encodeURIComponent(query.organization)}` : "/roles/new"}>
            <PlusIcon data-icon="inline-start" />
            New role
          </Link>
        </Button>
      }
    >
      <DataTable
        id="admin-roles"
        label="Roles"
        noun={["role", "roles"]}
        rowKey={(role) => String(role.id)}
        rowLabel={(role) => role.display_name}
        rowHref={(role) => `/roles/${role.id}`}
        columns={columns}
        {...table}
        groups={[
          { id: "organization", label: "Organization", value: (role) => role.organization.name },
          { id: "type", label: "Type", value: (role) => (role.is_default ? "Default" : "Custom") },
        ]}
      />
    </CollectionPage>
  )
}
