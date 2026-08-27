import type {
  DirectoryQuery,
  OrganizationRole,
  PaginatedResponse,
} from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { DirectoryFilters } from "../components/DirectoryFilters"
import { DirectoryEmpty, DirectoryError, DirectoryLoading } from "../components/DirectoryStates"
import { ResourceDirectory } from "../components/ResourceDirectory"
import {
  useDirectory,
  useDirectoryParameters,
  useOrganizationOptions,
} from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"
import { Link } from "react-router-dom"

const headings = ["Role", "Organization", "Type", "Permissions"]
const number = new Intl.NumberFormat()

function loadRoles(query: DirectoryQuery): Promise<PaginatedResponse<OrganizationRole>> {
  return apiClient.adminRoles(query)
}

export function RolesPage() {
  const query = useDirectoryParameters()
  const organizations = useOrganizationOptions()
  const { data, error } = useDirectory(loadRoles, query)

  return (
    <ResourceDirectory
      title="Roles"
      description="Review tenant roles and their permission coverage."
      directoryTitle="Role directory"
      directoryDescription="Search by role name or filter by organization."
      filters={
        <DirectoryFilters
          searchPlaceholder="Search roles…"
          organizations={organizations}
        />
      }
      pagination={data?.meta}
    >
      {error ? (
        <DirectoryError />
      ) : !data ? (
        <DirectoryLoading headings={headings} />
      ) : data.data.length === 0 ? (
        <DirectoryEmpty description="Try another role name or organization." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {headings.map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex min-w-40 flex-col gap-1">
                    <Link className="font-medium hover:underline" to={`/roles/${role.id}`}>
                      {role.display_name}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">{role.key}</span>
                  </div>
                </TableCell>
                <TableCell>{role.organization.name}</TableCell>
                <TableCell>
                  <Badge variant={role.is_default ? "secondary" : "outline"}>
                    {role.is_default ? "Default" : "Custom"}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">
                  {number.format(role.permissions_count)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ResourceDirectory>
  )
}
