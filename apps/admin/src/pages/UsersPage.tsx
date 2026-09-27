import { useState } from "react"
import type { DirectoryQuery, PaginatedResponse, PlatformUser } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { MoreHorizontalIcon, UserPlusIcon } from "lucide-react"
import { DirectoryFilters } from "../components/DirectoryFilters"
import {
  countLabel,
  DirectoryEmpty,
  DirectoryError,
  DirectoryLoading,
} from "../components/DirectoryStates"
import { InviteUserDialog } from "../components/InviteUserDialog"
import { MemberDialogs, type MemberAction } from "../components/MemberDialogs"
import { PendingInvitations } from "../components/PendingInvitations"
import { ResourceDirectory } from "../components/ResourceDirectory"
import {
  isFiltered,
  useDirectory,
  useDirectoryParameters,
  useOrganizationOptions,
} from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

const headings = ["User", "Email", "Organizations", "Platform access"]

function loadUsers(query: DirectoryQuery): Promise<PaginatedResponse<PlatformUser>> {
  return apiClient.adminUsers(query)
}

function platformAccess(user: PlatformUser): string {
  if (user.is_super_admin) return "Super admin"
  if (user.platform_roles.length > 0) return "Platform administrator"
  return "Tenant user"
}

export function UsersPage() {
  const query = useDirectoryParameters()
  const organizations = useOrganizationOptions()
  const { data, error, reload } = useDirectory(loadUsers, query)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitationRefreshKey, setInvitationRefreshKey] = useState(0)
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null)

  return (
    <ResourceDirectory
      title="Users"
      filters={<DirectoryFilters searchPlaceholder="Name or email" organizations={organizations} />}
      count={data ? countLabel(data.meta.total, "user", "users") : undefined}
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
        <DirectoryEmpty
          noun="users"
          filtered={isFiltered(query)}
          hint="Try another name, email or organization."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {headings.map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">
                  {user.organizations.length > 0 ? (
                    user.organizations.map((organization) => organization.name).join(", ")
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{platformAccess(user)}</TableCell>
                <TableCell className="w-0 text-right">
                  {user.organizations.length > 0 ? (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setMemberAction({ kind: "roles", user })}>
                          Change roles
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setMemberAction({ kind: "remove", user })}
                        >
                          Remove member
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
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
      <MemberDialogs
        action={memberAction}
        preferredOrganization={query.organization}
        onClose={() => setMemberAction(null)}
        onRemoved={reload}
      />
    </ResourceDirectory>
  )
}
