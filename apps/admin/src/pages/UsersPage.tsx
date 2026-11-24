import { useMemo, useState } from "react"
import type { AuthenticatedUser, DirectoryQuery, Organization, PaginatedResponse, PlatformUser } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Status } from "@iot-os/ui/components/status-mark"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { UserPlusIcon, UsersIcon } from "lucide-react"
import { ImpersonateDialog } from "../components/ImpersonateDialog"
import { InviteUserDialog } from "../components/InviteUserDialog"
import { MemberDialogs, type MemberAction } from "../components/MemberDialogs"
import { PendingInvitations } from "../components/PendingInvitations"
import { PlatformAdministratorDialog, type PlatformAdministratorAction } from "../components/PlatformAdministratorDialog"
import { SuperAdministratorDialog, type SuperAdministratorAction } from "../components/SuperAdministratorDialog"
import { TwoStepResetDialog } from "../components/TwoStepResetDialog"
import { useDirectoryTable } from "../components/ResourceDirectory"
import { useDirectoryParameters, useOrganizationOptions } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"

type Tab = "users" | "invitations"

function loadUsers(query: DirectoryQuery): Promise<PaginatedResponse<PlatformUser>> {
  return apiClient.adminUsers(query)
}

function platformAccess(user: PlatformUser): string {
  if (user.is_super_admin) return "Super admin"
  if (user.platform_roles.length > 0) return "Platform administrator"
  return "Tenant user"
}

function twoStep(user: PlatformUser): "enabled" | "not_set_up" {
  return user.two_step_enabled ? "enabled" : "not_set_up"
}

function isPlatformAdministrator(user: PlatformUser): boolean {
  return user.platform_roles.some((role) => role.key === "platform-administrator")
}

export function UsersPage({ currentUser }: { currentUser: AuthenticatedUser }) {
  // Only super administrators manage super administrators (spec 007) and platform administrators (spec 008); the API re-checks.
  const managesPlatformAccess = currentUser.is_super_admin
  const organizations = useOrganizationOptions()
  const url = useUrlState()
  const query = useDirectoryParameters()
  const tab: Tab = url.get("tab") === "invitations" ? "invitations" : "users"
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitationRefreshKey, setInvitationRefreshKey] = useState(0)

  // Each tab searches and pages its own list, so switching starts the other one afresh.
  function show(next: Tab) {
    url.set({ tab: next === "users" ? null : next, search: null, organization: null })
  }

  return (
    <Tabs value={tab} onValueChange={(value) => show(value as Tab)} className="gap-0">
      <CollectionPage
        title="Users"
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlusIcon data-icon="inline-start" />
            Invite user
          </Button>
        }
        tabs={
          <div className="-mx-1 w-full overflow-x-auto scrollbar-none">
            <TabsList variant="line" className="justify-start px-1" aria-label="User views">
              <TabsTrigger value="users" className="flex-none">
                People
              </TabsTrigger>
              <TabsTrigger value="invitations" className="flex-none">
                Invitations
              </TabsTrigger>
            </TabsList>
          </div>
        }
      >
        <TabsContent value="users" className="min-w-0">
          <UserDirectory
            currentUser={currentUser}
            organizations={organizations}
            managesPlatformAccess={managesPlatformAccess}
          />
        </TabsContent>
        <TabsContent value="invitations" className="min-w-0">
          <PendingInvitations key={invitationRefreshKey} managesSuperAdministrators={managesPlatformAccess} />
        </TabsContent>
      </CollectionPage>
      <InviteUserDialog
        canInviteSuperAdministrators={managesPlatformAccess}
        organizations={organizations}
        initialOrganization={organizations.find((organization) => organization.uuid === query.organization)}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => {
          setInvitationRefreshKey((current) => current + 1)
          show("invitations")
        }}
      />
    </Tabs>
  )
}

function UserDirectory({
  currentUser,
  organizations,
  managesPlatformAccess,
}: {
  currentUser: AuthenticatedUser
  organizations: Organization[]
  managesPlatformAccess: boolean
}) {
  const { reload, query, table } = useDirectoryTable(loadUsers, {
    searchPlaceholder: "Name or email",
    organizations,
  })
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null)
  const [superAdministratorAction, setSuperAdministratorAction] = useState<SuperAdministratorAction | null>(null)
  const [platformAdministratorAction, setPlatformAdministratorAction] = useState<PlatformAdministratorAction | null>(null)
  const [twoStepReset, setTwoStepReset] = useState<PlatformUser | null>(null)
  const [impersonating, setImpersonating] = useState<PlatformUser | null>(null)
  // Spec 034: the API also refuses resetting yourself, and a super administrator unless you are one.
  const resetsTwoStep = currentUser.capabilities.reset_two_step === true
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
      {
        id: "two-step",
        header: "Two-step",
        value: (user) => (user.two_step_enabled ? "On" : "Not set up"),
        cell: (user) => <Status value={twoStep(user)} />,
      },
      {
        id: "passkeys",
        header: "Passkeys",
        align: "end",
        value: (user) => user.passkey_count ?? 0,
        cell: (user) => {
          const count = user.passkey_count ?? 0
          return count > 0 ? <span className="tabular-nums">{count}</span> : <span className="text-muted-foreground">None</span>
        },
      },
    ],
    [],
  )

  return (
    <>
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
          const platformAdministratorItem = !managesPlatformAccess || user.is_super_admin ? null : isPlatformAdministrator(user) ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setPlatformAdministratorAction({ kind: "revoke", user })}>
              Remove platform administrator
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setPlatformAdministratorAction({ kind: "grant", user })}>
              Make platform administrator
            </DropdownMenuItem>
          )
          const superAdministratorItem = !managesPlatformAccess ? null : !user.is_super_admin ? (
            <DropdownMenuItem onSelect={() => setSuperAdministratorAction({ kind: "grant", user })}>
              Make super administrator
            </DropdownMenuItem>
          ) : user.id !== currentUser.id ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setSuperAdministratorAction({ kind: "revoke", user })}>
              Remove super administrator
            </DropdownMenuItem>
          ) : null
          const accessItems = platformAdministratorItem || superAdministratorItem
          const twoStepItem =
            resetsTwoStep && user.id !== currentUser.id && (!user.is_super_admin || currentUser.is_super_admin) ? (
              <DropdownMenuItem variant="destructive" onSelect={() => setTwoStepReset(user)}>
                Reset two-step
              </DropdownMenuItem>
            ) : null
          // Only super administrators impersonate, and never themselves or another super administrator; the API re-checks.
          const impersonateItem =
            currentUser.is_super_admin && !user.is_super_admin && user.id !== currentUser.id ? (
              <DropdownMenuItem onSelect={() => setImpersonating(user)}>Impersonate</DropdownMenuItem>
            ) : null
          if (!isMember && !accessItems && !twoStepItem && !impersonateItem) return null
          return (
            <>
              {impersonateItem}
              {impersonateItem && (isMember || accessItems || twoStepItem) ? <DropdownMenuSeparator /> : null}
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
              {isMember && accessItems ? <DropdownMenuSeparator /> : null}
              {platformAdministratorItem}
              {superAdministratorItem}
              {(isMember || accessItems) && twoStepItem ? <DropdownMenuSeparator /> : null}
              {twoStepItem}
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
      <MemberDialogs
        action={memberAction}
        preferredOrganization={query.organization}
        onClose={() => setMemberAction(null)}
        onRemoved={reload}
      />
      <SuperAdministratorDialog
        action={superAdministratorAction}
        onClose={() => setSuperAdministratorAction(null)}
        onChanged={reload}
      />
      <PlatformAdministratorDialog
        action={platformAdministratorAction}
        onClose={() => setPlatformAdministratorAction(null)}
        onChanged={reload}
      />
      <TwoStepResetDialog user={twoStepReset} onClose={() => setTwoStepReset(null)} onReset={reload} />
      <ImpersonateDialog user={impersonating} onClose={() => setImpersonating(null)} />
    </>
  )
}
