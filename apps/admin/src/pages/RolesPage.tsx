import type {
  DirectoryQuery,
  OrganizationRole,
  PaginatedResponse,
} from "@iot-os/api-client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { DirectoryFilters } from "../components/DirectoryFilters"
import {
  countLabel,
  DirectoryEmpty,
  DirectoryError,
  DirectoryLoading,
} from "../components/DirectoryStates"
import { ResourceDirectory } from "../components/ResourceDirectory"
import {
  isFiltered,
  useDirectory,
  useDirectoryParameters,
  useOrganizationOptions,
} from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"
import { Link } from "react-router-dom"

const headings = ["Role", "Organization", "Type", "Permissions"]

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
      filters={<DirectoryFilters searchPlaceholder="Role name or key" organizations={organizations} />}
      count={data ? countLabel(data.meta.total, "role", "roles") : undefined}
      pagination={data?.meta}
    >
      {error ? (
        <DirectoryError />
      ) : !data ? (
        <DirectoryLoading headings={headings} />
      ) : data.data.length === 0 ? (
        <DirectoryEmpty
          noun="roles"
          filtered={isFiltered(query)}
          hint="Try another role name or organization."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {headings.map((heading) => (
                <TableHead key={heading} className={heading === "Permissions" ? "text-right" : undefined}>
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <Link className="font-medium underline-offset-4 hover:underline" to={`/roles/${role.id}`}>
                    {role.display_name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{role.key}</span>
                </TableCell>
                <TableCell>{role.organization.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {role.is_default ? "Default" : "Custom"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {role.permissions_count.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ResourceDirectory>
  )
}
