import { useMemo, useState, type FormEvent } from "react"
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { TenantPermission, TenantRole } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { EntityPage } from "@iot-os/ui/templates/entity-page"
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { FieldError } from "@iot-os/ui/components/field"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { PermissionMatrix, permissionChanges } from "@iot-os/ui/components/permission-matrix"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { LockKeyholeIcon, PlusIcon, ShieldIcon, Trash2Icon } from "lucide-react"
import { api } from "../lib/api"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import { Confirm, RequestError, SaveBar, TextField, fieldError } from "../components/forms"
import { ADMINISTRATOR_LOCKED, matrixItems, plural, roleSummary } from "./model"
import { useAdministration, useRoles } from "./shared"

/** Roles live in Settings. */
export const rolesPath = (org: string) => `/organizations/${org}/settings/roles`

const rolesUnavailable = (
  <EmptyState
    icon={<LockKeyholeIcon />}
    title="Roles unavailable"
    description="You need permission to view roles in this organization. Ask an organization administrator."
  />
)

/** The roles list, shown inside Settings. */
export function RolesList() {
  const { org, can, session } = useAdministration()
  if (session.isPending) return <Skeleton className="h-64 w-full" />
  if (!can.roles_view) return rolesUnavailable
  return <RoleDirectory key={org} org={org} />
}

/** New and existing role editors: full pages that return to Settings → Roles. */
export default function RoleRoutes() {
  const { org, can, session } = useAdministration()
  if (session.isPending) return <Skeleton className="m-4 h-64 md:m-6" />
  if (!can.roles_view) return <div className="p-4 md:p-6">{rolesUnavailable}</div>
  return (
    <Routes>
      <Route path="new" element={<RoleEditor key={org + "new"} org={org} />} />
      <Route path=":roleId" element={<RoleEditorRoute org={org} />} />
    </Routes>
  )
}

function RoleDirectory({ org }: { org: string }) {
  const { can } = useAdministration()
  const roles = useRoles(org)
  const base = rolesPath(org)
  const columns = useMemo<DataColumn<TenantRole>[]>(
    () => [
      {
        id: "role",
        header: "Role",
        mobile: "title",
        sortable: true,
        value: (role) => role.display_name,
        cell: (role) => (
          <div className="flex flex-wrap items-center gap-2">
            <RowLink to={`${base}/${role.id}`}>{role.display_name}</RowLink>
            {role.is_default && <Badge variant="outline">Built-in</Badge>}
          </div>
        ),
      },
      {
        id: "permissions",
        header: "Permissions",
        value: (role) => roleSummary(role),
        cell: (role) => <span className="text-muted-foreground">{roleSummary(role)}</span>,
      },
      {
        id: "members",
        header: "Members",
        align: "end",
        sortable: true,
        value: (role) => role.members_count ?? 0,
        cell: (role) => <span className="text-muted-foreground tabular-nums">{role.members_count ?? "—"}</span>,
      },
    ],
    [base],
  )
  return (
    <CollectionPage
      embedded
      title="Roles"
      helpContext="roles"
      description="Members get every permission in each role they hold. Organization Admin always has every permission."
      actions={
        can.roles_create && (
          <Button size="sm" asChild>
            <Link to={`${base}/new`}>
              <PlusIcon data-icon="inline-start" />
              New role
            </Link>
          </Button>
        )
      }
    >
      <DataTable
        id="roles"
        label="Roles"
        noun={["role", "roles"]}
        rows={roles.data}
        rowKey={(role) => String(role.id)}
        rowHref={(role) => `${base}/${role.id}`}
        columns={columns}
        error={
          roles.error ? (
            <RequestError error={roles.error}>
              <Button variant="outline" onClick={() => void roles.refetch()}>
                Retry
              </Button>
            </RequestError>
          ) : undefined
        }
      />
    </CollectionPage>
  )
}

function RoleEditorRoute({ org }: { org: string }) {
  const { roleId } = useParams()
  const roles = useRoles(org)
  const role = roles.data?.find((item) => String(item.id) === roleId)
  if (roles.isPending) return <Skeleton className="m-4 h-64 md:m-6" />
  if (roles.error) return <div className="p-4 md:p-6"><RequestError error={roles.error} /></div>
  if (!role)
    return (
      <>
        <PageHeader title="Role not found" back={{ to: rolesPath(org), label: "Roles" }} />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This role no longer exists</EmptyTitle>
            <EmptyDescription>It may have been deleted. Go back to the role list.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    )
  return <RoleEditor key={`${org}:${role.id}`} org={org} role={role} />
}

function RoleEditor({ org, role }: { org: string; role?: TenantRole }) {
  const { can } = useAdministration()
  const { setDirty } = useDirtyContext()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const base = rolesPath(org)
  const catalogue = useQuery({
    queryKey: ["role-permissions", org],
    queryFn: () => api.organizationRolePermissions(org),
  })
  const initialNames = useMemo(() => new Set(role?.permissions.map((permission) => permission.name) ?? []), [role])
  const [savedName, setSavedName] = useState(role?.display_name ?? "")
  const [saved, setSaved] = useState<ReadonlySet<string>>(initialNames)
  const [name, setName] = useState(savedName)
  const [selected, setSelected] = useState<ReadonlySet<string>>(initialNames)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [deleting, setDeleting] = useState(false)

  const administrator = Boolean(role?.is_administrator)
  const editable = role ? can.roles_update && role.manageable === true : can.roles_create
  const changes = permissionChanges(selected, saved)
  const dirty = editable && (changes.dirty || name.trim() !== savedName)
  useUnsaved(dirty)

  const permissions: TenantPermission[] = catalogue.data ?? []
  const items = matrixItems(permissions, { administrator, readOnly: !editable })

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const values = { display_name: name.trim(), permission_names: [...selected] }
    try {
      const result = role
        ? await api.updateOrganizationRole(org, role.id, values)
        : await api.createOrganizationRole(org, values)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["roles", org] }),
        // Editing a role you hold changes your own capabilities.
        cache.invalidateQueries({ queryKey: ["session"] }),
      ])
      const names = new Set(result.permissions.map((permission) => permission.name))
      setSavedName(result.display_name)
      setSaved(names)
      setSelected(names)
      toast.success(role ? `${result.display_name} saved` : `${result.display_name} created`)
      if (!role) {
        setDirty(false)
        navigate(base, { replace: true })
      }
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  const title = role ? role.display_name : "New role"
  const deletable = role && !role.is_default && can.roles_delete && role.manageable === true

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <EntityPage
        title={title}
        icon={<ShieldIcon />}
        helpContext="roles.editor"
        back={{ to: base, label: "Roles" }}
        actions={
          deletable && (
            <Button type="button" size="sm" variant="outline" onClick={() => setDeleting(true)}>
              <Trash2Icon data-icon="inline-start" />
              Delete role
            </Button>
          )
        }
        status={
          role && (
            <>
              {role.is_default ? <StatusMark tone="muted">Built-in</StatusMark> : <StatusMark tone="info">Custom</StatusMark>}
              <span className="text-muted-foreground">{plural(role.members_count ?? 0, "member")}</span>
            </>
          )
        }
        className="flex-1"
        notices={
          administrator ? (
          <Alert>
            <LockKeyholeIcon />
            <AlertTitle>Permissions follow the organization</AlertTitle>
            <AlertDescription>
              {ADMINISTRATOR_LOCKED} Platform administrators decide which permissions are available.
            </AlertDescription>
          </Alert>
        ) : role && !editable ? (
          <Alert>
            <LockKeyholeIcon />
            <AlertTitle>View only</AlertTitle>
            <AlertDescription>
              {can.roles_update
                ? "This role has permissions you don't hold, so you can't change it."
                : "You can view roles but not change them."}
            </AlertDescription>
          </Alert>
        ) : null
        }
      >
        <Panel>
          <PanelHeader>
            <PanelTitle>Details</PanelTitle>
          </PanelHeader>
          <PanelContent className="max-w-md">
          <TextField
            label="Role name"
            required
            maxLength={255}
            value={name}
            disabled={!editable || administrator || busy}
            error={fieldError(error, "display_name")}
            onChange={(event) => setName(event.target.value)}
          />
          </PanelContent>
        </Panel>
        <Panel aria-labelledby="role-permissions-heading">
          <PanelHeader>
            <PanelTitle id="role-permissions-heading">Permissions</PanelTitle>
            <PanelDescription className="tabular-nums">
              {plural(selected.size, "permission")} selected
            </PanelDescription>
            {editable && !administrator && permissions.some((permission) => permission.grantable === false) && (
              <span className="flex items-center gap-1 text-meta text-muted-foreground">
                <LockKeyholeIcon aria-hidden="true" className="size-3.5" />
                Locked permissions are ones you don't hold yourself.
              </span>
            )}
          </PanelHeader>
          <PanelContent className="flex flex-col gap-2">
          {catalogue.error ? (
            <RequestError error={catalogue.error} />
          ) : catalogue.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <PermissionMatrix
              permissions={items}
              selected={selected}
              initial={role ? saved : undefined}
              disabled={busy}
              headingLevel={3}
              onChange={setSelected}
            />
          )}
          <FieldError>{fieldError(error, "permission_names")}</FieldError>
          {error && !fieldError(error, "display_name") && !fieldError(error, "permission_names") ? (
            <RequestError error={error} />
          ) : null}
          </PanelContent>
        </Panel>
      </EntityPage>
      {editable && !administrator && (
        <SaveBar
          dirty={dirty}
          busy={busy}
          disabled={!name.trim()}
          onCancel={() => {
            // A new role leaves the page; the unsaved-changes guard asks before discarding.
            if (!role) return navigate(base)
            setName(savedName)
            setSelected(saved)
            setError(null)
          }}
          label={role ? "Save changes" : "Create role"}
        />
      )}
      {role && (
        <Confirm
          open={deleting}
          title={`Delete ${role.display_name}?`}
          description="Only roles that no member holds and no pending invitation uses can be deleted."
          action="Delete role"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.deleteOrganizationRole(org, role.id)
            // Leave before refetching: the refreshed list no longer has this role, which unmounts the editor.
            setDirty(false)
            navigate(base, { replace: true })
            toast.success(`${role.display_name} deleted`)
            await cache.invalidateQueries({ queryKey: ["roles", org] })
          }}
        />
      )}
    </form>
  )
}
