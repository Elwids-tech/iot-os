import { useMemo, useState } from "react"
import type { DirectoryQuery, Organization, PaginatedResponse } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { Building2Icon, PlusIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { countLabel } from "../components/DirectoryStates"
import { InviteUserDialog } from "../components/InviteUserDialog"
import { OrganizationDialog } from "../components/OrganizationDialog"
import { useDirectoryTable } from "../components/ResourceDirectory"
import { useOrganizationOptions } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

function loadOrganizations(query: DirectoryQuery): Promise<PaginatedResponse<Organization>> {
  return apiClient.adminOrganizations(query)
}

export function OrganizationsPage() {
  const { reload, table } = useDirectoryTable(loadOrganizations, { searchPlaceholder: "Name or slug" })
  const [editing, setEditing] = useState<Organization | "new" | null>(null)
  const [inviting, setInviting] = useState<Organization | null>(null)
  const organizations = useOrganizationOptions()
  const columns = useMemo<DataColumn<Organization>[]>(
    () => [
      {
        id: "organization",
        header: "Organization",
        mobile: "title",
        value: (organization) => organization.name,
        cell: (organization) => <span className="font-medium">{organization.name}</span>,
      },
      {
        id: "slug",
        header: "Slug",
        value: (organization) => organization.slug,
        cell: (organization) => (
          <span className="font-mono text-code text-muted-foreground">{organization.slug}</span>
        ),
      },
      {
        id: "users",
        header: "Users",
        align: "end",
        summary: "sum",
        value: (organization) => organization.users_count ?? 0,
        cell: (organization) => (
          <RefLink
            className="tabular-nums"
            to={`/users?organization=${encodeURIComponent(organization.uuid)}`}
            aria-label={`${countLabel(organization.users_count ?? 0, "member", "members")} of ${organization.name}`}
          >
            {(organization.users_count ?? 0).toLocaleString()}
          </RefLink>
        ),
      },
    ],
    [],
  )

  return (
    <CollectionPage
      title="Organizations"
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          New organization
        </Button>
      }
    >
      <DataTable
        id="admin-organizations"
        label="Organizations"
        noun={["organization", "organizations"]}
        rowKey={(organization) => organization.uuid}
        rowLabel={(organization) => organization.name}
        columns={columns}
        {...table}
        rowActions={(organization) => (
          <>
            <DropdownMenuItem onSelect={() => setEditing(organization)}>Edit organization</DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={`/organizations/${encodeURIComponent(organization.uuid)}/permissions`}>
                Available permissions
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to={`/roles?organization=${encodeURIComponent(organization.uuid)}`}>Roles</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={`/roles/new?organization=${encodeURIComponent(organization.uuid)}`}>New role</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setInviting(organization)}>Invite user</DropdownMenuItem>
          </>
        )}
        empty={
          <EmptyState
            inset
            icon={<Building2Icon />}
            title="No organizations yet"
            description="Create an organization to give a customer its own workspace."
          />
        }
      />
      <OrganizationDialog organization={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <InviteUserDialog
        organizations={organizations}
        initialOrganization={inviting ?? undefined}
        open={inviting !== null}
        onOpenChange={(open) => {
          if (!open) setInviting(null)
        }}
        onInvited={() => undefined}
      />
    </CollectionPage>
  )
}
