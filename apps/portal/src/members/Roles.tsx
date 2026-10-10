import { useMemo, useState, type FormEvent } from "react"
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { TenantPermission, TenantRole } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { PermissionMatrix, permissionChanges } from "@iot-os/ui/components/permission-matrix"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { LockKeyholeIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { api } from "../lib/api"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import { Confirm, RequestError, SaveBar, TextField, fieldError } from "../components/forms"
import { ADMINISTRATOR_LOCKED, managesRoles, matrixItems, plural, roleSummary } from "./model"
import { useAdministration, useRoles } from "./shared"

export default function RoleRoutes() {
  const { org, can, session } = useAdministration()
  if (session.isPending) return <Skeleton className="m-4 h-64 md:m-6" />
  if (!managesRoles(can))
    return (
      <>
        <PageHeader title="Roles" />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Roles unavailable</EmptyTitle>
            <EmptyDescription>
              Only people who can create or edit roles see this page. Ask an organization administrator.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    )
  return (
    <Routes>
      <Route index element={<RoleDirectory key={org} org={org} />} />
      <Route path="new" element={<RoleEditor key={org + "new"} org={org} />} />
      <Route path=":roleId" element={<RoleEditorRoute org={org} />} />
    </Routes>
  )
}

function RoleDirectory({ org }: { org: string }) {
  const { can } = useAdministration()
  const roles = useRoles(org)
  const base = `/organizations/${org}/roles`
  return (
    <>
      <PageHeader
        title="Roles"
        helpContext="roles"
        actions={
          can.roles_create && (
            <Button asChild>
              <Link to={`${base}/new`}>
                <PlusIcon data-icon="inline-start" />
                Create role
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          A role bundles permissions. Members get every permission in each role they hold. Organization Admin always has
          every permission available to this organization.
        </p>
        {roles.error ? (
          <RequestError error={roles.error}>
            <Button variant="outline" onClick={() => void roles.refetch()}>
              Retry
            </Button>
          </RequestError>
        ) : roles.isPending ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-medium text-primary hover:underline" to={`${base}/${role.id}`}>
                        {role.display_name}
                      </Link>
                      {role.is_default && <Badge variant="outline">Built-in</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{roleSummary(role)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{role.members_count ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`${base}/${role.id}`}>{can.roles_update && role.manageable ? "Edit" : "View"}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
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
        <PageHeader title="Role not found" back={{ to: `/organizations/${org}/roles`, label: "Roles" }} />
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
  const base = `/organizations/${org}/roles`
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

  const title = role ? role.display_name : "Create role"
  const deletable = role && !role.is_default && can.roles_delete && role.manageable === true

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <PageHeader
        title={title}
        helpContext="roles.editor"
        back={{ to: base, label: "Roles" }}
        actions={
          deletable && (
            <Button type="button" variant="outline" onClick={() => setDeleting(true)}>
              <Trash2Icon data-icon="inline-start" />
              Delete role
            </Button>
          )
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        {administrator ? (
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
        ) : null}
        <div className="max-w-md">
          <TextField
            label="Role name"
            required
            maxLength={255}
            value={name}
            disabled={!editable || administrator || busy}
            error={fieldError(error, "display_name")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <section aria-labelledby="role-permissions-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 id="role-permissions-heading" className="text-sm font-semibold">
              Permissions
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {plural(selected.size, "permission")} selected
            </span>
            {editable && !administrator && permissions.some((permission) => permission.grantable === false) && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <LockKeyholeIcon aria-hidden="true" className="size-3.5" />
                Locked permissions are ones you don't hold yourself.
              </span>
            )}
          </div>
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
          {fieldError(error, "permission_names") && (
            <p role="alert" className="text-sm text-destructive">
              {fieldError(error, "permission_names")}
            </p>
          )}
          {error && !fieldError(error, "display_name") && !fieldError(error, "permission_names") ? (
            <RequestError error={error} />
          ) : null}
        </section>
      </div>
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
