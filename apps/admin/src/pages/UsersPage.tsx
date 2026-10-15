import { useMemo, useState } from "react"
import type { AuthenticatedUser, DirectoryQuery, PaginatedResponse, PlatformUser } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { UserPlusIcon, UsersIcon } from "lucide-react"
import { InviteUserDialog } from "../components/InviteUserDialog"
import { MemberDialogs, type MemberAction } from "../components/MemberDialogs"
import { PendingInvitations } from "../components/PendingInvitations"
import { PlatformAdministratorDialog, type PlatformAdministratorAction } from "../components/PlatformAdministratorDialog"
import { useDirectoryTable } from "../components/ResourceDirectory"
import { useOrganizationOptions } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

function loadUsers(query: DirectoryQuery): Promise<PaginatedResponse<PlatformUser>> {
  return apiClient.adminUsers(query)
}

function platformAccess(user: PlatformUser): string {
  if (user.is_super_admin) return "Super admin"
  if (user.platform_roles.length > 0) return "Platform administrator"
  return "Tenant user"
}

function isPlatformAdministrator(user: PlatformUser): boolean {
  return user.platform_roles.some((role) => role.key === "platform-administrator")
}

export function UsersPage({ currentUser }: { currentUser: AuthenticatedUser }) {
  // Only super administrators grant or remove the platform-administrator role (spec 008); the API re-checks.
  const managesPlatformAdministrators = currentUser.is_super_admin
  const organizations = useOrganizationOptions()
  const { reload, query, table } = useDirectoryTable(loadUsers, {
    searchPlaceholder: "Name or email",
    organizations,
  })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitationRefreshKey, setInvitationRefreshKey] = useState(0)
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null)
  const [platformAdministratorAction, setPlatformAdministratorAction] = useState<PlatformAdministratorAction | null>(null)
  const columns = useMemo<DataColumn<PlatformUser>[]>(
    () => [
      { id: "user", header: "User", mobile: "title", value: (user) => user.name, cell: (user) => <span className="font-medium">{user.name}</span> },
      { id: "email", header: "Email", value: (user) => user.email, cell: (user) => <span className="text-muted-foreground">{user.email}</span> },
      {
        id: "organizations",
        header: "Organizations",
        className: "min-w-48 whitespace-normal",
        value: (user) => user.organizations.map((organization) => organization.name).join(", "),
        cell: (user) =>
          user.organizations.length > 0 ? (
            user.organizations.map((organization) => organization.name).join(", ")
          ) : (
            <span className="text-muted-foreground">None</span>
          ),
      },
      {
        id: "access",
        header: "Platform access",
        value: platformAccess,
        cell: (user) => <span className="text-muted-foreground">{platformAccess(user)}</span>,
      },
    ],
    [],
  )

  return (
    <CollectionPage
      title="Users"
      actions={
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlusIcon data-icon="inline-start" />
          Invite user
        </Button>
      }
    >
      <DataTable
        id="admin-users"
        label="Users"
        noun={["user", "users"]}
        rowKey={(user) => String(user.id)}
        rowLabel={(user) => user.name}
        columns={columns}
        {...table}
        groups={[{ id: "access", label: "Platform access", value: platformAccess }]}
        rowActions={(user) => {
          const isMember = user.organizations.length > 0
          // A super administrator already passes every check, so their row offers no role change.
          const offersPlatformAdministrator = managesPlatformAdministrators && !user.is_super_admin
          const platformAdministratorItem = !offersPlatformAdministrator ? null : isPlatformAdministrator(user) ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setPlatformAdministratorAction({ kind: "revoke", user })}>
              Remove platform administrator
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setPlatformAdministratorAction({ kind: "grant", user })}>
              Make platform administrator
            </DropdownMenuItem>
          )
          if (!isMember && !platformAdministratorItem) return null
          return (
            <>
              {isMember ? (
                <>
                  <DropdownMenuItem onSelect={() => setMemberAction({ kind: "roles", user })}>
                    Change roles
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setMemberAction({ kind: "remove", user })}>
                    Remove member
                  </DropdownMenuItem>
                </>
              ) : null}
              {isMember && platformAdministratorItem ? <DropdownMenuSeparator /> : null}
              {platformAdministratorItem}
            </>
          )
        }}
        empty={
          <EmptyState
            inset
            icon={<UsersIcon />}
            title="No users yet"
            description="Invite someone to an organization to create their account."
          />
        }
      />
      <PendingInvitations refreshKey={invitationRefreshKey} />
      <InviteUserDialog
        organizations={organizations}
        initialOrganization={organizations.find((organization) => organization.uuid === query.organization)}
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
      <PlatformAdministratorDialog
        action={platformAdministratorAction}
        onClose={() => setPlatformAdministratorAction(null)}
        onChanged={reload}
      />
    </CollectionPage>
  )
}
