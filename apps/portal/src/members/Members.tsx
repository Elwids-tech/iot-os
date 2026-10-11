import { useMemo, useState, type FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { OrganizationMember, TenantInvitation, TenantRole } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { FieldGroup } from "@iot-os/ui/components/field"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { formatDateTime } from "@iot-os/ui/lib/format"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { MailIcon, MailPlusIcon, TriangleAlertIcon, UsersIcon } from "lucide-react"
import { api } from "../lib/api"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import {
  Confirm,
  EditorSheet,
  RequestError,
  SaveBar,
  TextField,
  fieldError,
} from "../components/forms"
import { expiryLabel, losesOwnAdministration, sameSelection } from "./model"
import { RoleBadges, RoleChecklist, useAdministration, useRoles } from "./shared"

type Tab = "members" | "invitations"

export function MembersPage() {
  const { org, organization, can, session } = useAdministration()
  const cache = useQueryClient()
  const { setDirty } = useDirtyContext()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get("tab") === "invitations" ? "invitations" : "members"
  const [inviting, setInviting] = useState(false)
  const roles = useRoles(org, can.invite || can.members_update)

  function show(next: Tab) {
    const values = new URLSearchParams(params)
    if (next === "members") values.delete("tab")
    else values.set("tab", next)
    values.delete("page")
    setParams(values, { replace: true })
  }

  if (session.isPending) return <Skeleton className="h-64 w-full" />
  if (!can.members_view)
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="Members unavailable"
        description="You need permission to list members in this organization. Ask an organization administrator."
      />
    )

  return (
    <Tabs value={tab} onValueChange={(value) => show(value as Tab)} className="flex-1 gap-0">
      <CollectionPage
        embedded
        title="Members"
        helpContext="members"
        actions={
          can.invite && (
            <Button size="sm" onClick={() => setInviting(true)}>
              <MailPlusIcon data-icon="inline-start" />
              Invite people
            </Button>
          )
        }
        tabs={
          <div className="-mx-1 w-full overflow-x-auto scrollbar-none">
            <TabsList variant="line" className="justify-start px-1" aria-label="Member views">
              <TabsTrigger value="members" className="flex-none">
                People
              </TabsTrigger>
              <TabsTrigger value="invitations" className="flex-none">
                Invitations
              </TabsTrigger>
            </TabsList>
          </div>
        }
      >
        <TabsContent value="members">
          <MemberDirectory org={org} roles={roles.data ?? []} organizationName={organization?.name ?? "this organization"} />
        </TabsContent>
        <TabsContent value="invitations">
          <Invitations org={org} onInvite={can.invite ? () => setInviting(true) : undefined} />
        </TabsContent>
      </CollectionPage>
      {inviting && (
        <InviteSheet
          roles={roles.data ?? []}
          rolesError={roles.error}
          onClose={() => setInviting(false)}
          onInvite={async (email, roleIds) => {
            const invitation = await api.inviteOrganizationMember(org, email, roleIds)
            await cache.invalidateQueries({ queryKey: ["invitations", org] })
            setInviting(false)
            // The sheet is closing; its draft is saved, so the tab switch must not ask to discard it.
            setDirty(false)
            toast.success(`Invitation sent to ${invitation.email}`)
            show("invitations")
          }}
        />
      )}
    </Tabs>
  )
}

function MemberDirectory({ org, roles, organizationName }: { org: string; roles: TenantRole[]; organizationName: string }) {
  const { can } = useAdministration()
  const cache = useQueryClient()
  const url = useUrlState()
  const search = url.get("search")
  const page = Math.max(1, Number(url.get("page")) || 1)
  const [editing, setEditing] = useState<OrganizationMember | null>(null)
  const [removing, setRemoving] = useState<OrganizationMember | null>(null)
  const query = useQuery({
    queryKey: ["members", org, search, page],
    queryFn: () => api.organizationMembers(org, { search, page, perPage: 25 }),
    placeholderData: keepPreviousData,
  })
  const actions = can.members_update || can.members_remove

  async function refresh(self = false) {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["members", org] }),
      cache.invalidateQueries({ queryKey: ["roles", org] }),
      self ? cache.invalidateQueries({ queryKey: ["session"] }) : null,
    ])
  }

  const columns = useMemo<DataColumn<OrganizationMember>[]>(
    () => [
      {
        id: "member",
        header: "Member",
        mobile: "title",
        className: "max-w-80",
        value: (member) => member.name,
        cell: (member) => (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{member.name}</span>
              {member.is_current_user && <Badge variant="outline">You</Badge>}
            </div>
            <div className="truncate text-meta text-muted-foreground">{member.email}</div>
          </>
        ),
      },
      {
        id: "roles",
        header: "Roles",
        value: (member) => member.roles.map((role) => role.display_name).join(", "),
        cell: (member) => <RoleBadges roles={member.roles} />,
      },
    ],
    [],
  )

  return (
    <>
      <DataTable
        id="members"
        label="Members"
        noun={["member", "members"]}
        rows={query.data?.data}
        rowKey={(member) => String(member.id)}
        rowLabel={(member) => member.name}
        columns={columns}
        error={
          query.error ? (
            <RequestError error={query.error}>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </RequestError>
          ) : undefined
        }
        search={{
          label: "Search members",
          placeholder: "Name or email",
          value: search,
          onChange: (value) => url.set({ search: value }),
        }}
        filtered={Boolean(search)}
        pagination={{
          page,
          pageSize: 25,
          total: query.data?.meta.total ?? 0,
          pageCount: query.data?.meta.last_page,
          onPageChange: (next) => url.set({ page: next > 1 ? String(next) : null }),
        }}
        rowActions={
          actions
            ? (member) => (
                <>
                  {can.members_update && (
                    <DropdownMenuItem disabled={member.manageable === false} onSelect={() => setEditing(member)}>
                      Change roles
                    </DropdownMenuItem>
                  )}
                  {can.members_remove && !member.is_current_user && (
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={member.manageable === false}
                      onSelect={() => setRemoving(member)}
                    >
                      Remove from organization
                    </DropdownMenuItem>
                  )}
                  {member.manageable === false && (
                    <p className="max-w-56 px-2 py-1.5 text-meta text-muted-foreground">
                      This member has access you don't hold, so you can't change it.
                    </p>
                  )}
                </>
              )
            : undefined
        }
        empty={
          <EmptyState
            inset
            icon={<UsersIcon />}
            title="No members yet"
            description="Invite people to give them access to this organization."
          />
        }
      />
      {editing && (
        <ChangeRolesSheet
          member={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSave={async (roleIds) => {
            await api.syncOrganizationMemberRoles(org, editing.id, roleIds)
            await refresh(editing.is_current_user)
            setEditing(null)
            toast.success(`Roles updated for ${editing.name}`)
          }}
        />
      )}
      <Confirm
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? "member"}?`}
        description={`They lose access to ${organizationName} immediately. Their account and any other organizations they belong to are not affected.`}
        action="Remove member"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await api.removeOrganizationMember(org, removing.id)
          await refresh()
          toast.success(`${removing.name} was removed`)
        }}
      />
    </>
  )
}

function Invitations({ org, onInvite }: { org: string; onInvite?: () => void }) {
  const { can } = useAdministration()
  const cache = useQueryClient()
  const [revoking, setRevoking] = useState<TenantInvitation | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const [resendError, setResendError] = useState<unknown>(null)
  const pending = useQuery({
    queryKey: ["invitations", org, "pending"],
    queryFn: () => api.organizationInvitations(org, { status: "pending" }),
  })
  const expired = useQuery({
    queryKey: ["invitations", org, "expired"],
    queryFn: () => api.organizationInvitations(org, { status: "expired" }),
  })
  const rows = useMemo(
    () =>
      pending.data && expired.data ? [...pending.data.data, ...expired.data.data] : undefined,
    [pending.data, expired.data],
  )
  const error = pending.error ?? expired.error
  const refresh = () => cache.invalidateQueries({ queryKey: ["invitations", org] })

  async function resend(invitation: TenantInvitation) {
    setResending(invitation.uuid)
    setResendError(null)
    try {
      await api.resendOrganizationInvitation(org, invitation.uuid)
      await refresh()
      toast.success(`A new link was sent to ${invitation.email}`)
    } catch (reason) {
      setResendError(reason)
    } finally {
      setResending(null)
    }
  }

  const columns = useMemo<DataColumn<TenantInvitation>[]>(
    () => [
      {
        id: "email",
        header: "Email",
        mobile: "title",
        className: "max-w-72 truncate font-medium",
        sortable: true,
        value: (invitation) => invitation.email,
        cell: (invitation) => invitation.email,
      },
      {
        id: "roles",
        header: "Roles",
        value: (invitation) => invitation.roles.map((role) => role.display_name).join(", "),
        cell: (invitation) => <RoleBadges roles={invitation.roles} />,
      },
      {
        id: "invited-by",
        header: "Invited by",
        mobile: "hidden",
        value: (invitation) => invitation.invited_by?.name,
        cell: (invitation) => (
          <span className="text-muted-foreground">{invitation.invited_by?.name ?? "—"}</span>
        ),
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        value: (invitation) => invitation.expires_at,
        cell: (invitation) => (
          <StatusMark
            tone={invitation.status === "expired" ? "muted" : "info"}
            title={formatDateTime(invitation.expires_at)}
          >
            {expiryLabel(invitation)}
          </StatusMark>
        ),
      },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-3">
      <RequestError error={resendError} />
      <DataTable
        id="invitations"
        label="Invitations"
        noun={["invitation", "invitations"]}
        rows={rows}
        rowKey={(invitation) => invitation.uuid}
        rowLabel={(invitation) => invitation.email}
        columns={columns}
        toolbar={
          <span className="text-meta text-muted-foreground">
            Links work for seven days. Sending again replaces the old link.
          </span>
        }
        error={
          error ? (
            <RequestError error={error}>
              <Button variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </RequestError>
          ) : undefined
        }
        rowActions={
          can.invite
            ? (invitation) => (
                <>
                  <DropdownMenuItem
                    disabled={invitation.manageable === false || resending !== null}
                    onSelect={() => void resend(invitation)}
                  >
                    Send again
                  </DropdownMenuItem>
                  {invitation.status === "pending" && (
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={invitation.manageable === false}
                      onSelect={() => setRevoking(invitation)}
                    >
                      Revoke
                    </DropdownMenuItem>
                  )}
                </>
              )
            : undefined
        }
        empty={
          <EmptyState
            inset
            icon={<MailIcon />}
            title="No open invitations"
            description="Invitations you send appear here until they are accepted."
            action={
              onInvite && (
                <Button variant="outline" size="sm" onClick={onInvite}>
                  Invite people
                </Button>
              )
            }
          />
        }
      />
      <Confirm
        open={Boolean(revoking)}
        title={`Revoke the invitation for ${revoking?.email ?? "this person"}?`}
        description="The link stops working immediately. You can invite them again later."
        action="Revoke invitation"
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return
          await api.revokeOrganizationInvitation(org, revoking.uuid)
          await refresh()
          toast.success("Invitation revoked")
        }}
      />
    </div>
  )
}

function InviteSheet({
  roles,
  rolesError,
  onClose,
  onInvite,
}: {
  roles: TenantRole[]
  rolesError: unknown
  onClose: () => void
  onInvite: (email: string, roleIds: number[]) => Promise<void>
}) {
  const [email, setEmail] = useState("")
  const [roleIds, setRoleIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const dirty = email.trim() !== "" || roleIds.length > 0
  useUnsaved(dirty)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onInvite(email.trim(), roleIds)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <EditorSheet
      title="Invite people"
      description="They get an email with a link to join. New people create an account; existing users sign in."
      dirty={dirty}
      busy={busy}
      onClose={onClose}
    >
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <div className="flex-1 overflow-y-auto p-6">
          <FieldGroup>
            <TextField
              label="Email address"
              type="email"
              required
              autoComplete="off"
              value={email}
              error={fieldError(error, "email")}
              onChange={(event) => setEmail(event.target.value)}
            />
            <RequestError error={rolesError} />
            <RoleChecklist
              roles={roles}
              value={roleIds}
              onChange={setRoleIds}
              disabled={busy}
              error={fieldError(error, "role_ids")}
            />
            {error && !fieldError(error, "email") && !fieldError(error, "role_ids") ? <RequestError error={error} /> : null}
          </FieldGroup>
        </div>
        <SaveBar
          dirty={dirty}
          busy={busy}
          disabled={!email.trim() || !roleIds.length}
          onCancel={onClose}
          label="Send invitation"
        />
      </form>
    </EditorSheet>
  )
}

function ChangeRolesSheet({
  member,
  roles,
  onClose,
  onSave,
}: {
  member: OrganizationMember
  roles: TenantRole[]
  onClose: () => void
  onSave: (roleIds: number[]) => Promise<void>
}) {
  const current = member.roles.map((role) => role.id)
  const [roleIds, setRoleIds] = useState<number[]>(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const dirty = !sameSelection(current, roleIds)
  const losingAccess = losesOwnAdministration(Boolean(member.is_current_user), roles, current, roleIds)
  useUnsaved(dirty)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave(roleIds)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <EditorSheet
      title={`Change roles for ${member.name}`}
      description={member.email}
      dirty={dirty}
      busy={busy}
      onClose={onClose}
    >
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <div className="flex-1 overflow-y-auto p-6">
          <FieldGroup>
            <RoleChecklist
              roles={roles}
              value={roleIds}
              onChange={setRoleIds}
              disabled={busy}
              error={fieldError(error, "role_ids")}
            />
            {losingAccess && (
              <Alert>
                <TriangleAlertIcon />
                <AlertDescription>
                  You are removing your own Organization Admin role. You may lose access to this page after saving.
                </AlertDescription>
              </Alert>
            )}
            {error && !fieldError(error, "role_ids") ? <RequestError error={error} /> : null}
          </FieldGroup>
        </div>
        <SaveBar dirty={dirty} busy={busy} disabled={!roleIds.length} onCancel={onClose} />
      </form>
    </EditorSheet>
  )
}
