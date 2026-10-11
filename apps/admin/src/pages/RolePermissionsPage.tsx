import { FormEvent, useEffect, useMemo, useState } from "react"
import type { OrganizationRole, OrganizationRoleDetail, RolePermission } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
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
import {
  FilterBar,
  FilterCount,
  FilterField,
  FilterSearch,
} from "@iot-os/ui/components/filter-bar"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { PermissionMatrix } from "@iot-os/ui/components/permission-matrix"
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
import { keepToastsAbove } from "@iot-os/ui/components/sonner"
import { AlertCircleIcon, ChevronsUpDownIcon, LockKeyholeIcon, SearchXIcon } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { permissionGroupLabel, permissionLabel } from "@iot-os/ui/lib/permission-labels"

type RoleState = {
  data?: OrganizationRoleDetail
  error: boolean
}

const back = { to: "/roles", label: "Roles" }

function permissionNames(permissions: RolePermission[]): Set<string> {
  return new Set(permissions.filter((permission) => permission.assigned).map((permission) => permission.name))
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

  const visiblePermissions = useMemo(() => {
    if (!state.data) return []

    const normalizedSearch = search.trim().toLocaleLowerCase()
    return state.data.permissions.filter(
      (permission) =>
        (group === "all" || permission.group === group) &&
        (!normalizedSearch ||
          permission.name.toLocaleLowerCase().includes(normalizedSearch) ||
          permissionLabel(permission.name).toLocaleLowerCase().includes(normalizedSearch)),
    )
  }, [group, search, state.data])

  const groupNames = useMemo(
    () => (state.data ? [...new Set(state.data.permissions.map((permission) => permission.group))] : []),
    [state.data],
  )
  const visibleCount = visiblePermissions.length

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
        <form onSubmit={submitSearch} role="search" className="flex min-w-0 flex-1">
          <FilterBar>
            <FilterSearch
              id="permission-search"
              name="search"
              label="Search permissions"
              autoComplete="off"
              placeholder="Permission or key"
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
            />
            <FilterField
              label="Filter by permission group"
              id="permission-group-filter"
              className="min-w-0 flex-1 sm:w-48 sm:flex-none"
            >
              {(id) => (
                <Select value={group} onValueChange={selectGroup}>
                  <SelectTrigger id={id} className="w-full">
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
              )}
            </FilterField>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
            {search || group !== "all" ? (
              <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
            <FilterCount className="whitespace-nowrap">
              {visibleCount} of {role.permissions.length} permissions
            </FilterCount>
          </FilterBar>
        </form>
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

        {visiblePermissions.length === 0 ? (
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
          <PermissionMatrix
            permissions={visiblePermissions}
            selected={selectedPermissionNames}
            initial={initialPermissionNames}
            disabled={!role.permissions_editable || isSaving}
            onChange={setSelectedPermissionNames}
          />
        )}
      </div>

      {role.permissions_editable ? (
        <div ref={keepToastsAbove} className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3 md:px-6">
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
