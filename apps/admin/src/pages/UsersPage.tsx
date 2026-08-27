import { useState } from "react"
import type { DirectoryQuery, PaginatedResponse, PlatformUser } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { UserPlusIcon } from "lucide-react"
import { DirectoryFilters } from "../components/DirectoryFilters"
import { DirectoryEmpty, DirectoryError, DirectoryLoading } from "../components/DirectoryStates"
import { InviteUserDialog } from "../components/InviteUserDialog"
import { PendingInvitations } from "../components/PendingInvitations"
import { ResourceDirectory } from "../components/ResourceDirectory"
import {
  useDirectory,
  useDirectoryParameters,
  useOrganizationOptions,
} from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

const headings = ["User", "Email", "Organizations", "Platform access"]

function loadUsers(query: DirectoryQuery): Promise<PaginatedResponse<PlatformUser>> {
  return apiClient.adminUsers(query)
}

function PlatformAccess({ user }: { user: PlatformUser }) {
  if (user.is_super_admin) {
    return <Badge>Super admin</Badge>
  }

  if (user.platform_roles.length > 0) {
    return <Badge variant="secondary">Platform administrator</Badge>
  }

  return <Badge variant="outline">Tenant user</Badge>
}

export function UsersPage() {
  const query = useDirectoryParameters()
  const organizations = useOrganizationOptions()
  const { data, error } = useDirectory(loadUsers, query)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitationRefreshKey, setInvitationRefreshKey] = useState(0)

  return (
    <ResourceDirectory
      title="Users"
      description="Review platform accounts and their organization memberships."
      directoryTitle="User directory"
      directoryDescription="Search by name or email, or filter by organization."
      filters={
        <DirectoryFilters
          searchPlaceholder="Search users…"
          organizations={organizations}
        />
      }
      pagination={data?.meta}
      actions={
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlusIcon data-icon="inline-start" />
          Invite user
        </Button>
      }
      after={<PendingInvitations refreshKey={invitationRefreshKey} />}
    >
      {error ? (
        <DirectoryError />
      ) : !data ? (
        <DirectoryLoading headings={headings} />
      ) : data.data.length === 0 ? (
        <DirectoryEmpty description="Try another name, email, or organization." />
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
            {data.data.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="break-words text-muted-foreground">{user.email}</TableCell>
                <TableCell>
                  {user.organizations.length > 0 ? (
                    <div className="flex min-w-48 flex-wrap gap-1">
                      {user.organizations.map((organization) => (
                        <Badge key={organization.uuid} variant="outline">
                          {organization.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell>
                  <PlatformAccess user={user} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <InviteUserDialog
        organizations={organizations}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => setInvitationRefreshKey((current) => current + 1)}
      />
    </ResourceDirectory>
  )
}
