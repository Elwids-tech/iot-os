import { FormEvent, useEffect, useMemo, useState } from "react"
import type { TenantPermission } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { FieldError, FieldGroup } from "@iot-os/ui/components/field"
import { SelectField, TextField } from "@iot-os/ui/components/form-fields"
import { PageHeader } from "@iot-os/ui/components/page-header"
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { PermissionMatrix } from "@iot-os/ui/components/permission-matrix"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { keepToastsAbove } from "@iot-os/ui/components/sonner"
import { AlertCircleIcon, Building2Icon, ShieldOffIcon } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { useOrganizationOptions } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

type Catalogue =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; permissions: TenantPermission[] }

/** A custom role for one organization: its name and permissions from the organization's ceiling. */
export function NewRolePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const organizations = useOrganizationOptions()
  const [organizationUuid, setOrganizationUuid] = useState(searchParams.get("organization") ?? "")
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [catalogue, setCatalogue] = useState<Catalogue>({ status: "idle" })
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createdId, setCreatedId] = useState<number | null>(null)

  const back = {
    to: organizationUuid ? `/roles?organization=${encodeURIComponent(organizationUuid)}` : "/roles",
    label: "Roles",
  }
  const organization = organizations.find((item) => item.uuid === organizationUuid)
  const dirty = createdId === null && (name.trim() !== "" || selected.size > 0)
  const { dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this new role?",
    description: "The role has not been created yet. Its name and permissions will be lost.",
  })

  useEffect(() => {
    let active = true

    if (!organizationUuid) {
      setCatalogue({ status: "idle" })
      return () => {
        active = false
      }
    }

    setCatalogue({ status: "loading" })
    apiClient
      .organizationRolePermissions(organizationUuid)
      .then((permissions) => {
        if (!active) return
        setCatalogue({ status: "ready", permissions })
        // Organizations allow different permissions; keep only what this one allows.
        const allowed = new Set(permissions.map((permission) => permission.name))
        setSelected((current) => new Set([...current].filter((permission) => allowed.has(permission))))
      })
      .catch(() => {
        if (active) setCatalogue({ status: "error" })
      })

    return () => {
      active = false
    }
  }, [organizationUuid])

  // Leave once the role exists and the page is no longer dirty, so the discard guard stays quiet.
  useEffect(() => {
    if (createdId !== null) navigate(`/roles/${createdId}`, { replace: true })
  }, [createdId, navigate])

  const items = useMemo(
    () =>
      catalogue.status === "ready"
        ? catalogue.permissions.map((permission) => ({
            name: permission.name,
            group: permission.group,
            lockedReason: permission.grantable === false ? "You can't grant this permission." : null,
          }))
        : [],
    [catalogue],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organizationUuid || !name.trim() || busy) return
    setErrors(null)
    setFormError(null)
    setBusy(true)

    try {
      const role = await apiClient.createOrganizationRole(organizationUuid, {
        display_name: name.trim(),
        permission_names: [...selected].sort(),
      })
      toast.success(`${role.display_name} created${organization ? ` in ${organization.name}` : ""}`)
      setCreatedId(role.id)
    } catch (error) {
      const fields = validationErrors(error)
      setErrors(fields)
      setFormError(
        fieldMessages(fields, "display_name") || fieldMessages(fields, "permission_names")
          ? null
          : errorMessage(error),
      )
    } finally {
      setBusy(false)
    }
  }

  const nameErrors = fieldMessages(errors, "display_name")
  const permissionErrors = fieldMessages(errors, "permission_names")
  const total = catalogue.status === "ready" ? catalogue.permissions.length : 0

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <PageHeader
        title="New role"
        back={back}
        meta={organization ? organization.name : undefined}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <Panel>
          <PanelHeader>
            <PanelTitle>Details</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <FieldGroup className="max-w-md">
              <SelectField
                id="new-role-organization"
                label="Organization"
                value={organizationUuid}
                onChange={setOrganizationUuid}
                placeholder="Select an organization"
                disabled={busy}
                help="The role belongs to this organization only."
                options={organizations.map((item) => ({ value: item.uuid, label: item.name }))}
              />
              <TextField
                id="new-role-name"
                label="Role name"
                value={name}
                maxLength={255}
                autoComplete="off"
                required
                disabled={busy}
                error={nameErrors?.[0]}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldGroup>
          </PanelContent>
        </Panel>

        <Panel aria-labelledby="new-role-permissions-heading">
          <PanelHeader>
            <PanelTitle id="new-role-permissions-heading">Permissions</PanelTitle>
            {catalogue.status === "ready" ? (
              <PanelDescription className="tabular-nums">
                {selected.size} of {total} selected
              </PanelDescription>
            ) : null}
          </PanelHeader>
          <PanelContent className="flex flex-col gap-2">
            {catalogue.status === "idle" ? (
              <Empty className="min-h-48 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Building2Icon />
                  </EmptyMedia>
                  <EmptyTitle>Choose an organization</EmptyTitle>
                  <EmptyDescription>Its available permissions are listed here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : catalogue.status === "loading" ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : catalogue.status === "error" ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Could not load permissions</AlertTitle>
                <AlertDescription>Choose the organization again or reload the page.</AlertDescription>
              </Alert>
            ) : total === 0 ? (
              <Empty className="min-h-48 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ShieldOffIcon />
                  </EmptyMedia>
                  <EmptyTitle>No permissions available</EmptyTitle>
                  <EmptyDescription>
                    This organization's roles can't hold any permissions yet. You can still create
                    the role and add permissions later.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/organizations/${encodeURIComponent(organizationUuid)}/permissions`}>
                      Available permissions
                    </Link>
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <PermissionMatrix
                permissions={items}
                selected={selected}
                disabled={busy}
                onChange={setSelected}
              />
            )}
            <FieldError errors={permissionErrors?.map((message) => ({ message }))} />
            {formError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Role not created</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
          </PanelContent>
        </Panel>
      </div>

      <div
        ref={keepToastsAbove}
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3 md:px-6"
      >
        <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
          {organization
            ? `New role in ${organization.name} · ${selected.size} ${selected.size === 1 ? "permission" : "permissions"}`
            : "Choose an organization and name the role"}
        </p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => navigate(back.to)}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !organizationUuid || !name.trim() || catalogue.status !== "ready"}>
          {busy ? "Creating…" : "Create role"}
        </Button>
      </div>
      {discardDialog}
    </form>
  )
}
