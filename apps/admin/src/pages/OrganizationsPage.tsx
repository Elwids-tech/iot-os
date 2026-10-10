import { useState } from "react"
import type { DirectoryQuery, Organization, PaginatedResponse } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { PlusIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { DirectoryFilters } from "../components/DirectoryFilters"
import {
  countLabel,
  DirectoryEmpty,
  DirectoryError,
  DirectoryLoading,
} from "../components/DirectoryStates"
import { OrganizationDialog } from "../components/OrganizationDialog"
import { ResourceDirectory } from "../components/ResourceDirectory"
import { isFiltered, useDirectory, useDirectoryParameters } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

const headings = ["Organization", "Slug", "Users"]

function loadOrganizations(query: DirectoryQuery): Promise<PaginatedResponse<Organization>> {
  return apiClient.adminOrganizations(query)
}

export function OrganizationsPage() {
  const query = useDirectoryParameters()
  const { data, error, reload } = useDirectory(loadOrganizations, query)
  const [editing, setEditing] = useState<Organization | "new" | null>(null)
  const create = (
    <Button onClick={() => setEditing("new")}>
      <PlusIcon data-icon="inline-start" />
      New organization
    </Button>
  )

  return (
    <ResourceDirectory
      title="Organizations"
      filters={<DirectoryFilters searchPlaceholder="Name or slug" />}
      count={data ? countLabel(data.meta.total, "organization", "organizations") : undefined}
      pagination={data?.meta}
      actions={create}
    >
      {error ? (
        <DirectoryError />
      ) : !data ? (
        <DirectoryLoading headings={headings} />
      ) : data.data.length === 0 ? (
        <DirectoryEmpty
          noun="organizations"
          filtered={isFiltered(query)}
          hint="Try another name or slug."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {headings.map((heading) => (
                <TableHead key={heading} className={heading === "Users" ? "text-right" : undefined}>
                  {heading}
                </TableHead>
              ))}
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((organization) => (
              <TableRow key={organization.uuid}>
                <TableCell className="font-medium">{organization.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {organization.slug}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link
                    className="underline-offset-4 hover:underline"
                    to={`/users?organization=${encodeURIComponent(organization.uuid)}`}
                    aria-label={`${countLabel(organization.users_count ?? 0, "member", "members")} of ${organization.name}`}
                  >
                    {(organization.users_count ?? 0).toLocaleString()}
                  </Link>
                </TableCell>
                <TableCell className="w-0 text-right">
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to={`/organizations/${encodeURIComponent(organization.uuid)}/permissions`}
                        aria-label={`Available permissions for ${organization.name}`}
                      >
                        Permissions
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${organization.name}`}
                      onClick={() => setEditing(organization)}
                    >
                      Edit
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <OrganizationDialog organization={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </ResourceDirectory>
  )
}
