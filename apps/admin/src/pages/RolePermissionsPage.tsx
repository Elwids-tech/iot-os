import { FormEvent, useEffect, useMemo, useState } from "react"
import type { OrganizationRole, OrganizationRoleDetail, RolePermission } from "@iot-os/api-client"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@iot-os/ui/components/accordion"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { Separator } from "@iot-os/ui/components/separator"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { AlertCircleIcon, ArrowLeftIcon, LockKeyholeIcon, RotateCcwIcon, SaveIcon, SearchXIcon } from "lucide-react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { apiClient } from "../lib/api-client"

type RoleState = {
  data?: OrganizationRoleDetail
  error: boolean
}

function permissionNames(permissions: RolePermission[]): Set<string> {
  return new Set(permissions.filter((permission) => permission.assigned).map((permission) => permission.name))
}

function samePermissions(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((name) => right.has(name))
}

function groupedPermissions(permissions: RolePermission[]): Map<string, RolePermission[]> {
  return permissions.reduce((groups, permission) => {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission])
    return groups
  }, new Map<string, RolePermission[]>())
}

function PermissionLoading() {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

export function RolePermissionsPage() {
  const { roleId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState<RoleState>({ error: false })
  const [roleOptions, setRoleOptions] = useState<OrganizationRole[]>([])
  const [selectedPermissionNames, setSelectedPermissionNames] = useState<Set<string>>(new Set())
  const [initialPermissionNames, setInitialPermissionNames] = useState<Set<string>>(new Set())
  const [draftSearch, setDraftSearch] = useState(searchParams.get("search") ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const numericRoleId = Number.parseInt(roleId ?? "", 10)
  const navigate = useNavigate()
  const search = searchParams.get("search") ?? ""
  const group = searchParams.get("group") ?? "all"

  useEffect(() => setDraftSearch(search), [search])

  useEffect(() => {
    let active = true

    apiClient
      .adminRoles({ perPage: 100 })
      .then((response) => {
        if (active) setRoleOptions(response.data)
      })
      .catch(() => {
        if (active) setRoleOptions([])
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    if (!Number.isSafeInteger(numericRoleId) || numericRoleId < 1) {
      setState({ error: true })
      return () => {
        active = false
      }
    }

    setState({ error: false })
    apiClient
      .adminRole(numericRoleId)
      .then((data) => {
        if (!active) return

        const assigned = permissionNames(data.permissions)
        setInitialPermissionNames(assigned)
        setSelectedPermissionNames(new Set(assigned))
        setState({ data, error: false })
      })
      .catch(() => {
        if (active) setState({ error: true })
      })

    return () => {
      active = false
    }
  }, [numericRoleId])

  const permissionGroups = useMemo(() => {
    if (!state.data) return new Map<string, RolePermission[]>()

    const normalizedSearch = search.trim().toLocaleLowerCase()
    const filtered = state.data.permissions.filter(
      (permission) =>
        (group === "all" || permission.group === group) &&
        (!normalizedSearch || permission.name.toLocaleLowerCase().includes(normalizedSearch)),
    )

    return groupedPermissions(filtered)
  }, [group, search, state.data])

  const groupNames = useMemo(
    () => (state.data ? [...new Set(state.data.permissions.map((permission) => permission.group))] : []),
    [state.data],
  )

  const isDirty = !samePermissions(selectedPermissionNames, initialPermissionNames)
  const role = state.data
  const roleSelectorOptions = useMemo(() => {
    if (!role || roleOptions.some((option) => option.id === role.id)) return roleOptions

    return [role, ...roleOptions]
  }, [role, roleOptions])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const next = new URLSearchParams(searchParams)
    const value = draftSearch.trim()

    if (value) {
      next.set("search", value)
    } else {
      next.delete("search")
    }

    setSearchParams(next)
  }

  function selectGroup(value: string) {
    const next = new URLSearchParams(searchParams)

    if (value === "all") {
      next.delete("group")
    } else {
      next.set("group", value)
    }

    setSearchParams(next)
  }

  function clearFilters() {
    setDraftSearch("")
    setSearchParams(new URLSearchParams())
  }

  function selectRole(value: string) {
    const nextRoleId = Number.parseInt(value, 10)

    if (!role || !Number.isSafeInteger(nextRoleId) || nextRoleId === role.id) return

    navigate(`/roles/${nextRoleId}`)
  }

  function togglePermission(name: string, checked: boolean) {
    if (!role?.permissions_editable || isSaving) return

    setSelectedPermissionNames((current) => {
      const next = new Set(current)

      if (checked) {
        next.add(name)
      } else {
        next.delete(name)
      }

      return next
    })
  }

  function toggleGroup(groupName: string) {
    if (!role?.permissions_editable || isSaving) return

    const groupPermissions = role.permissions.filter((permission) => permission.group === groupName)
    const groupIsFullySelected = groupPermissions.every((permission) =>
      selectedPermissionNames.has(permission.name),
    )

    setSelectedPermissionNames((current) => {
      const next = new Set(current)

      for (const permission of groupPermissions) {
        if (groupIsFullySelected) {
          next.delete(permission.name)
        } else {
          next.add(permission.name)
        }
      }

      return next
    })
  }

  function resetChanges() {
    setSelectedPermissionNames(new Set(initialPermissionNames))
    setSaveError(false)
  }

  async function saveChanges() {
    if (!role || !role.permissions_editable || !isDirty || isSaving) return

    setIsSaving(true)
    setSaveError(false)

    try {
      const data = await apiClient.syncAdminRolePermissions(
        role.id,
        [...selectedPermissionNames].sort(),
      )
      const assigned = permissionNames(data.permissions)

      setState({ data, error: false })
      setInitialPermissionNames(assigned)
      setSelectedPermissionNames(new Set(assigned))
    } catch {
      setSaveError(true)
    } finally {
      setIsSaving(false)
    }
  }

  if (state.error) {
    return (
      <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
        <Button asChild className="w-fit" variant="outline">
          <Link to="/roles">
            <ArrowLeftIcon data-icon="inline-start" />
            Back to Roles
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Could not load this role</AlertTitle>
          <AlertDescription>Return to the role directory and try again.</AlertDescription>
        </Alert>
      </section>
    )
  }

  if (!role) return <PermissionLoading />

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <Button asChild className="w-fit" variant="outline">
          <Link to="/roles">
            <ArrowLeftIcon data-icon="inline-start" />
            Back to Roles
          </Link>
        </Button>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{role.display_name}</h1>
            <Badge variant={role.is_default ? "secondary" : "outline"}>
              {role.is_default ? "Default" : "Custom"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {role.organization.name} · {selectedPermissionNames.size} of {role.permissions.length} tenant permissions selected
          </p>
        </div>
        <Field className="w-full md:max-w-md">
          <FieldLabel htmlFor="role-selector">Select role</FieldLabel>
          <Select value={role.id.toString()} onValueChange={selectRole}>
            <SelectTrigger id="role-selector">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {roleSelectorOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id.toString()}>
                    {option.display_name} · {option.organization.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {!role.permissions_editable ? (
        <Alert>
          <LockKeyholeIcon />
          <AlertTitle>Permission baseline protected</AlertTitle>
          <AlertDescription>{role.permission_update_message}</AlertDescription>
        </Alert>
      ) : null}

      {saveError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Could not save permissions</AlertTitle>
          <AlertDescription>Your current selections have not been discarded. Try again.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="min-w-0">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>Role permissions</CardTitle>
            <p className="text-sm text-muted-foreground">
              Filter the synchronized enum permissions, then select or clear a complete group.
            </p>
          </div>
          <form onSubmit={submitSearch} role="search">
            <FieldGroup className="flex flex-col gap-3 md:flex-row md:items-end">
              <Field className="min-w-0 flex-1">
                <FieldLabel className="sr-only" htmlFor="permission-search">
                  Search permissions
                </FieldLabel>
                <Input
                  id="permission-search"
                  name="search"
                  type="search"
                  autoComplete="off"
                  placeholder="Search permission names…"
                  value={draftSearch}
                  onChange={(event) => setDraftSearch(event.target.value)}
                />
              </Field>
              <Field className="md:w-56">
                <FieldLabel className="sr-only" htmlFor="permission-group-filter">
                  Filter by permission group
                </FieldLabel>
                <Select value={group} onValueChange={selectGroup}>
                  <SelectTrigger id="permission-group-filter">
                    <SelectValue placeholder="All permission groups" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value="all">All permission groups</SelectItem>
                      {groupNames.map((groupName) => (
                        <SelectItem key={groupName} value={groupName}>
                          {groupName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex gap-2">
                <Button type="submit">Search</Button>
                {search || group !== "all" ? (
                  <Button type="button" variant="outline" onClick={clearFilters}>
                    Clear
                  </Button>
                ) : null}
              </div>
            </FieldGroup>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {permissionGroups.size === 0 ? (
            <Empty className="min-h-72 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>No permissions found</EmptyTitle>
                <EmptyDescription>Try another permission name or group.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Accordion
              className="px-6"
              defaultValue={[...permissionGroups.keys()]}
              type="multiple"
            >
              {[...permissionGroups.entries()].map(([groupName, permissions]) => {
                const allGroupPermissions = role.permissions.filter(
                  (permission) => permission.group === groupName,
                )
                const selectedInGroup = allGroupPermissions.filter((permission) =>
                  selectedPermissionNames.has(permission.name),
                ).length
                const groupChecked =
                  selectedInGroup === 0
                    ? false
                    : selectedInGroup === allGroupPermissions.length
                      ? true
                      : "indeterminate"

                return (
                  <AccordionItem key={groupName} value={groupName}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        aria-label={`Select all ${groupName} permissions`}
                        checked={groupChecked}
                        disabled={!role.permissions_editable || isSaving}
                        onCheckedChange={() => toggleGroup(groupName)}
                      />
                      <AccordionTrigger className="py-4 hover:no-underline">
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-3">
                          <span>{groupName}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {selectedInGroup} of {allGroupPermissions.length} selected
                          </span>
                        </span>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent>
                      <fieldset className="flex flex-col gap-2 px-7 pb-3">
                        <legend className="sr-only">{groupName} permissions</legend>
                        {permissions.map((permission) => {
                          const id = `permission-${permission.name}`

                          return (
                            <label
                              key={permission.name}
                              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
                              htmlFor={id}
                            >
                              <Checkbox
                                id={id}
                                checked={selectedPermissionNames.has(permission.name)}
                                disabled={!role.permissions_editable || isSaving}
                                onCheckedChange={(checked) =>
                                  togglePermission(permission.name, checked === true)
                                }
                              />
                              <span className="font-mono text-xs">{permission.name}</span>
                            </label>
                          )
                        })}
                      </fieldset>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </CardContent>
        {role.permissions_editable ? (
          <>
            <Separator />
            <CardFooter className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {isDirty ? "Unsaved permission changes" : "All changes saved"}
              </p>
              <div className="flex gap-2">
                <Button disabled={!isDirty || isSaving} onClick={resetChanges} type="button" variant="outline">
                  <RotateCcwIcon data-icon="inline-start" />
                  Reset changes
                </Button>
                <Button disabled={!isDirty || isSaving} onClick={() => void saveChanges()} type="button">
                  <SaveIcon data-icon="inline-start" />
                  {isSaving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </CardFooter>
          </>
        ) : null}
      </Card>
    </section>
  )
}
