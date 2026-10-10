import { useState, type FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { OrganizationMember, TenantInvitation, TenantRole } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { formatDateTime } from "@iot-os/ui/lib/format"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { EllipsisIcon, MailPlusIcon, TriangleAlertIcon } from "lucide-react"
import { api } from "../lib/api"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import {
  Confirm,
  EditorSheet,
  Pager,
  RequestError,
  SaveBar,
  TextField,
  fieldError,
} from "../components/forms"
import { expiryLabel, losesOwnAdministration, plural, sameSelection } from "./model"
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

  if (session.isPending) return <Skeleton className="m-4 h-64 md:m-6" />
  if (!can.members_view)
    return (
      <>
        <PageHeader title="Members" />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Members unavailable</EmptyTitle>
            <EmptyDescription>
              You need permission to list members in this organization. Ask an organization administrator.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    )

  return (
    <Tabs value={tab} onValueChange={(value) => show(value as Tab)} className="flex-1 gap-0">
      <PageHeader
        title={tab === "members" ? "Members" : "Invitations · Members"}
        heading="Members"
        helpContext="members"
        actions={
          can.invite && (
            <Button onClick={() => setInviting(true)}>
              <MailPlusIcon data-icon="inline-start" />
              Invite people
            </Button>
          )
        }
      >
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
      </PageHeader>
      <TabsContent value="members" className="flex flex-col text-base">
        <MemberDirectory org={org} roles={roles.data ?? []} organizationName={organization?.name ?? "this organization"} />
      </TabsContent>
      <TabsContent value="invitations" className="flex flex-col text-base">
        <Invitations org={org} onInvite={can.invite ? () => setInviting(true) : undefined} />
      </TabsContent>
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
  const [params, setParams] = useSearchParams()
  const search = params.get("search") ?? ""
  const page = Math.max(1, Number(params.get("page")) || 1)
  const [editing, setEditing] = useState<OrganizationMember | null>(null)
  const [removing, setRemoving] = useState<OrganizationMember | null>(null)
  const query = useQuery({
    queryKey: ["members", org, search, page],
    queryFn: () => api.organizationMembers(org, { search, page, perPage: 25 }),
  })
  const rows = query.data?.data ?? []
  const actions = can.members_update || can.members_remove

  function filter(value: string) {
    const next = new URLSearchParams(params)
    value ? next.set("search", value) : next.delete("search")
    next.delete("page")
    setParams(next, { replace: true })
  }

  async function refresh(self = false) {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["members", org] }),
      cache.invalidateQueries({ queryKey: ["roles", org] }),
      self ? cache.invalidateQueries({ queryKey: ["session"] }) : null,
    ])
  }

  return (
    <div className="flex flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label htmlFor="member-search" className="sr-only">
          Search members
        </Label>
        <Input
          id="member-search"
          type="search"
          placeholder="Name or email"
          className="w-full sm:w-64"
          value={search}
          onChange={(event) => filter(event.target.value)}
        />
        {query.data && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {plural(query.data.meta.total, "member")}
          </span>
        )}
      </div>
      {query.error ? (
        <RequestError error={query.error}>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </RequestError>
      ) : query.isPending ? (
        <Skeleton className="h-52 w-full" />
      ) : !rows.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{search ? "No matching members" : "No members yet"}</EmptyTitle>
            <EmptyDescription>
              {search ? "Try a different name or email." : "Invite people to give them access to this organization."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Roles</TableHead>
              {actions && (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="max-w-80">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{member.name}</span>
                    {member.is_current_user && <Badge variant="outline">You</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                </TableCell>
                <TableCell>
                  <RoleBadges roles={member.roles} />
                </TableCell>
                {actions && (
                  <TableCell className="w-12 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name}`}>
                          <EllipsisIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
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
                          <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">
                            This member has access you don't hold, so you can't change it.
                          </p>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {query.data && query.data.meta.last_page > 1 && (
        <Pager
          page={page}
          pages={query.data.meta.last_page}
          onPage={(next) => {
            const values = new URLSearchParams(params)
            values.set("page", String(next))
            setParams(values)
          }}
        />
      )}
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
    </div>
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
  const rows = [...(pending.data?.data ?? []), ...(expired.data?.data ?? [])]
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

  return (
    <div className="flex flex-col gap-3 p-4 md:p-6">
      <p className="text-sm text-muted-foreground">
        Invitation links work for seven days. Sending again replaces the old link.
      </p>
      <RequestError error={resendError} />
      {error ? (
        <RequestError error={error}>
          <Button variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </RequestError>
      ) : pending.isPending || expired.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !rows.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No open invitations</EmptyTitle>
            <EmptyDescription>Invitations you send appear here until they are accepted.</EmptyDescription>
          </EmptyHeader>
          {onInvite && (
            <EmptyContent>
              <Button variant="outline" onClick={onInvite}>
                Invite people
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="hidden lg:table-cell">Invited by</TableHead>
              <TableHead>Status</TableHead>
              {can.invite && (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((invitation) => (
              <TableRow key={invitation.uuid}>
                <TableCell className="max-w-72 truncate font-medium">{invitation.email}</TableCell>
                <TableCell>
                  <RoleBadges roles={invitation.roles} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{invitation.invited_by?.name ?? "—"}</TableCell>
                <TableCell title={formatDateTime(invitation.expires_at)}>
                  <StatusMark tone={invitation.status === "expired" ? "muted" : "info"}>
                    {expiryLabel(invitation)}
                  </StatusMark>
                </TableCell>
                {can.invite && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={invitation.manageable === false || resending !== null}
                        onClick={() => void resend(invitation)}
                      >
                        {resending === invitation.uuid ? "Sending…" : "Send again"}
                      </Button>
                      {invitation.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={invitation.manageable === false}
                          onClick={() => setRevoking(invitation)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
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
