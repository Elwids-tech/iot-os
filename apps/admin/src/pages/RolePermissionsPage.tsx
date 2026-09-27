import { FormEvent, useEffect, useMemo, useState } from "react"
import type { OrganizationRole, OrganizationRoleDetail, RolePermission } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@iot-os/ui/components/collapsible"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@iot-os/ui/components/command"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Popover, PopoverContent, PopoverTrigger } from "@iot-os/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { AlertCircleIcon, ChevronDownIcon, ChevronsUpDownIcon, LockKeyholeIcon, SearchXIcon } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { permissionGroupLabel, permissionLabel } from "../lib/permissions"

type RoleState = {
  data?: OrganizationRoleDetail
  error: boolean
}

const back = { to: "/roles", label: "Roles" }

function permissionNames(permissions: RolePermission[]): Set<string> {
  return new Set(permissions.filter((permission) => permission.assigned).map((permission) => permission.name))
}

function groupedPermissions(permissions: RolePermission[]): Map<string, RolePermission[]> {
  return permissions.reduce((groups, permission) => {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission])
    return groups
  }, new Map<string, RolePermission[]>())
}

/** The page title is a searchable role switcher; navigation goes through the discard guard. */
function RoleSwitcher({ role }: { role: OrganizationRoleDetail }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [options, setOptions] = useState<OrganizationRole[] | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    const timer = window.setTimeout(() => {
      apiClient
        .adminRoles({ search, perPage: 25 })
        .then((response) => {
          if (active) setOptions(response.data)
        })
        .catch(() => {
          if (active) setOptions([])
        })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [open, search])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <PopoverTrigger
        title="Switch role"
        className="inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{role.display_name}</span>
        <ChevronsUpDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0" aria-label="Switch role">
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Search roles"
            placeholder="Search roles…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {options === null ? (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                Loading roles…
              </p>
            ) : (
              <>
                <CommandEmpty>No roles found.</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={option.id.toString()}
                      data-checked={option.id === role.id}
                      onSelect={() => {
                        setOpen(false)
                        if (option.id !== role.id) navigate(`/roles/${option.id}`)
                      }}
                    >
                      <span className="truncate">{option.display_name}</span>{" "}
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {option.organization.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function RolePermissionsPage() {
  const { roleId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState<RoleState>({ error: false })
  const [selectedPermissionNames, setSelectedPermissionNames] = useState<Set<string>>(new Set())
  const [initialPermissionNames, setInitialPermissionNames] = useState<Set<string>>(new Set())
  const [draftSearch, setDraftSearch] = useState(searchParams.get("search") ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const numericRoleId = Number.parseInt(roleId ?? "", 10)
  const search = searchParams.get("search") ?? ""
  const group = searchParams.get("group") ?? "all"

  useEffect(() => setDraftSearch(search), [search])

  useEffect(() => {
    let active = true
    setSelectedPermissionNames(new Set())
    setInitialPermissionNames(new Set())
    setSaveError(false)

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

  const role = state.data
  const added = [...selectedPermissionNames].filter((name) => !initialPermissionNames.has(name)).length
  const removed = [...initialPermissionNames].filter((name) => !selectedPermissionNames.has(name)).length
  const isDirty = added + removed > 0
  const { dialog: discardDialog } = useDiscardGuard(isDirty, {
    title: "Discard unsaved permission changes?",
    description: `${added} added and ${removed} removed permissions for ${role?.display_name ?? "this role"} will be lost.`,
  })

  const permissionGroups = useMemo(() => {
    if (!state.data) return new Map<string, RolePermission[]>()

    const normalizedSearch = search.trim().toLocaleLowerCase()
    const filtered = state.data.permissions.filter(
      (permission) =>
        (group === "all" || permission.group === group) &&
        (!normalizedSearch ||
          permission.name.toLocaleLowerCase().includes(normalizedSearch) ||
          permissionLabel(permission.name).toLocaleLowerCase().includes(normalizedSearch)),
    )

    return groupedPermissions(filtered)
  }, [group, search, state.data])

  const groupNames = useMemo(
    () => (state.data ? [...new Set(state.data.permissions.map((permission) => permission.group))] : []),
    [state.data],
  )
  const visibleCount = [...permissionGroups.values()].reduce((total, items) => total + items.length, 0)

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
      toast.success(`Permissions saved for ${data.display_name}`)
    } catch {
      setSaveError(true)
    } finally {
      setIsSaving(false)
    }
  }

  if (state.error) {
    return (
      <>
        <PageHeader title="Role" back={back} />
        <div className="p-4 md:p-6">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not load this role</AlertTitle>
            <AlertDescription>Go back to Roles and try again.</AlertDescription>
          </Alert>
        </div>
      </>
    )
  }

  if (!role) {
    return (
      <>
        <PageHeader title="Role" back={back} />
        <div className="flex flex-col gap-3 p-4 md:p-6" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={role.display_name}
        back={back}
        heading={<RoleSwitcher role={role} />}
        meta={`${role.organization.name} · ${role.is_default ? "Default" : "Custom"} role · ${selectedPermissionNames.size} of ${role.permissions.length} selected`}
      >
        <form
          onSubmit={submitSearch}
          role="search"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        >
          <Label className="sr-only" htmlFor="permission-search">
            Search permissions
          </Label>
          <Input
            id="permission-search"
            name="search"
            type="search"
            autoComplete="off"
            placeholder="Permission or key"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            className="h-7 w-full min-w-0 sm:w-64"
          />
          <Label className="sr-only" htmlFor="permission-group-filter">
            Filter by permission group
          </Label>
          <Select value={group} onValueChange={selectGroup}>
            <SelectTrigger id="permission-group-filter" size="sm" className="min-w-0 flex-1 sm:w-48 sm:flex-none">
              <SelectValue placeholder="All permission groups" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectItem value="all">All permission groups</SelectItem>
                {groupNames.map((groupName) => (
                  <SelectItem key={groupName} value={groupName}>
                    {permissionGroupLabel(groupName)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
          {search || group !== "all" ? (
            <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
        </form>
        <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {visibleCount} of {role.permissions.length} permissions
        </span>
      </PageHeader>

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
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

        {permissionGroups.size === 0 ? (
          <Empty className="min-h-64 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No matching permissions</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="border-t">
            {[...permissionGroups.entries()].map(([groupName, permissions]) => {
              const groupLabel = permissionGroupLabel(groupName)
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
                <Collapsible key={groupName} defaultOpen asChild>
                  <section className="border-b">
                    <div className="flex h-10 items-center gap-3">
                      <Checkbox
                        aria-label={`Select all ${groupLabel} permissions`}
                        checked={groupChecked}
                        disabled={!role.permissions_editable || isSaving}
                        onCheckedChange={() => toggleGroup(groupName)}
                      />
                      <h2 className="min-w-0 flex-1 text-sm font-semibold">
                        <CollapsibleTrigger className="group/trigger flex h-10 w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <ChevronDownIcon
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground group-data-[state=closed]/trigger:-rotate-90"
                          />
                          {groupLabel}
                        </CollapsibleTrigger>
                      </h2>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {selectedInGroup} of {allGroupPermissions.length} selected
                      </span>
                    </div>
                    <CollapsibleContent>
                      <fieldset className="grid gap-x-6 pb-3 sm:grid-cols-2 sm:pl-7 xl:grid-cols-3">
                        <legend className="sr-only">{groupLabel} permissions</legend>
                        {permissions.map((permission) => {
                          const id = `permission-${permission.name}`
                          const checked = selectedPermissionNames.has(permission.name)
                          const wasChecked = initialPermissionNames.has(permission.name)

                          return (
                            <label
                              key={permission.name}
                              className="group/permission flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-sm hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
                              htmlFor={id}
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                disabled={!role.permissions_editable || isSaving}
                                onCheckedChange={(value) =>
                                  togglePermission(permission.name, value === true)
                                }
                              />
                              <span className="truncate">{permissionLabel(permission.name)}</span>
                              <span className="ml-auto hidden truncate font-mono text-xs text-muted-foreground group-hover/permission:inline group-focus-within/permission:inline">
                                {permission.name}
                              </span>
                              {checked !== wasChecked ? (
                                <span
                                  className={
                                    checked
                                      ? "shrink-0 text-xs text-foreground"
                                      : "shrink-0 text-xs text-muted-foreground line-through"
                                  }
                                >
                                  {checked ? "added" : "removed"}
                                </span>
                              ) : null}
                            </label>
                          )
                        })}
                      </fieldset>
                    </CollapsibleContent>
                  </section>
                </Collapsible>
              )
            })}
          </div>
        )}
      </div>

      {role.permissions_editable ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3 md:px-6">
          <p className="mr-auto text-sm" aria-live="polite">
            {isDirty ? (
              <>
                Unsaved permission changes{" "}
                <span className="text-muted-foreground">
                  · {added} added, {removed} removed
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">All changes saved</span>
            )}
          </p>
          <Button disabled={!isDirty || isSaving} onClick={resetChanges} type="button" variant="outline">
            Reset changes
          </Button>
          <Button disabled={!isDirty || isSaving} onClick={() => void saveChanges()} type="button">
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
      {discardDialog}
    </>
  )
}
