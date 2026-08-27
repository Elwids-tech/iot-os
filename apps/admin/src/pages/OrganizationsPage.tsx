import type { DirectoryQuery, Organization, PaginatedResponse } from "@iot-os/api-client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { DirectoryFilters } from "../components/DirectoryFilters"
import { DirectoryEmpty, DirectoryError, DirectoryLoading } from "../components/DirectoryStates"
import { ResourceDirectory } from "../components/ResourceDirectory"
import { useDirectory, useDirectoryParameters } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

const headings = ["Organization", "Slug", "Users"]
const number = new Intl.NumberFormat()

function loadOrganizations(query: DirectoryQuery): Promise<PaginatedResponse<Organization>> {
  return apiClient.adminOrganizations(query)
}

export function OrganizationsPage() {
  const query = useDirectoryParameters()
  const { data, error } = useDirectory(loadOrganizations, query)

  return (
    <ResourceDirectory
      title="Organizations"
      description="Review every tenant registered on the platform."
      directoryTitle="Organization directory"
      directoryDescription="Search by organization name or slug."
      filters={<DirectoryFilters searchPlaceholder="Search organizations…" />}
      pagination={data?.meta}
    >
      {error ? (
        <DirectoryError />
      ) : !data ? (
        <DirectoryLoading headings={headings} />
      ) : data.data.length === 0 ? (
        <DirectoryEmpty description="Try another organization name or slug." />
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
            {data.data.map((organization) => (
              <TableRow key={organization.uuid}>
                <TableCell className="font-medium">{organization.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {organization.slug}
                </TableCell>
                <TableCell className="tabular-nums">
                  {number.format(organization.users_count ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ResourceDirectory>
  )
}
