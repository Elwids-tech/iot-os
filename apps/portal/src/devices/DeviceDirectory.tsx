import { useMemo, useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { ApiError, type Device, type DeviceInput } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  DataTable,
  RefLink,
  RowLink,
  type DataColumn,
  type DataGroup,
} from "@iot-os/ui/components/data-table"
import { CopyButton, CopyText } from "@iot-os/ui/components/copy-text"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Freshness } from "@iot-os/ui/components/freshness"
import { Tooltip, TooltipContent, TooltipTrigger } from "@iot-os/ui/components/tooltip"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { ArchiveIcon, CpuIcon, InboxIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { onboardingPath } from "./DeviceOnboarding"
import { useDirtyContext, useUnsaved } from "../lib/unsaved"
import {
  TextField,
  RequestError,
  EditorSheet,
  SaveBar,
  fieldError,
} from "../components/forms"
import {
  devicePath,
  discoveryPath,
  gatewayPath,
  HealthStatus,
  profilePath,
  useDeviceOrganization,
} from "./shared"
import { deviceHealth, listStatuses, RECENT_DATA_MS, shortDeviceCode } from "./model"

/** Lifecycle choices after the default, "Not archived"; "All" includes archived devices. */
const lifecycleOptions = [
  { value: "registered", label: "Registered" },
  { value: "active", label: "Active" },
  { value: "deactivated", label: "Deactivated" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
]
/** Lists show presence in Status and how recent the data is in Last seen, so "no recent data" never merges into one mark. */
const listFreshness = { recentMs: Number.POSITIVE_INFINITY }
/** An active, online device that has been quiet for longer than RECENT_DATA_MS reads late. */
const expectedSeconds = (device: Device) =>
  device.lifecycle === "active" && device.presence === "online" ? RECENT_DATA_MS / 2000 : null

/** Sortable columns and the devices API sort each one maps to. */
const sortColumns: Record<string, string> = { device: "name", code: "code", "last-seen": "last_seen" }

export function DeviceDirectory() {
  const { org, capabilities } = useDeviceOrganization()
  const url = useUrlState()
  const search = url.get("search"),
    lifecycle = url.get("lifecycle"),
    statuses = url.getAll("status"),
    site = url.get("site"),
    profile = url.get("profile")
  const page = Number(url.get("page") || 1),
    pageSize = Number(url.get("per_page") || 25),
    sort = url.get("sort") || "name"
  const sites = useQuery({ queryKey: ["sites", org], queryFn: () => api.sites(org) })
  // Site filter and column appear once the organization uses sites.
  const hasSites = (sites.data?.data.length ?? 0) > 0
  const profiles = useQuery({
    queryKey: ["device-profiles", org, "filter-options"],
    queryFn: () => api.deviceProfiles(org, { perPage: 100 }),
    retry: false,
  })
  const [quickEdit, setQuickEdit] = useState<Device>()
  const listFilters = {
    search,
    status: statuses,
    site_uuid: site || undefined,
    profile_uuid: profile || undefined,
  }
  const query = useQuery({
    queryKey: ["devices", org, { search, lifecycle, statuses, site, profile, sort, page, pageSize }],
    queryFn: () =>
      api.devices(org, {
        ...listFilters,
        // No lifecycle leaves archived devices out; "all" includes them.
        lifecycle: lifecycle === "all" ? undefined : lifecycle || "current",
        sort: sort === "name" ? undefined : sort,
        page,
        per_page: pageSize,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  // The default view says how many archived devices it leaves out.
  const archived = useQuery({
    queryKey: ["devices", org, "archived-count", { search, statuses, site, profile }],
    queryFn: async () =>
      (await api.devices(org, { ...listFilters, lifecycle: "archived", per_page: 1 })).meta.total,
    enabled: !lifecycle,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  })
  const hiddenArchived = lifecycle ? 0 : (archived.data ?? 0)
  const showArchived = () => url.set({ lifecycle: "all" })
  // Headers sort on the server once it echoes the applied sort; sorting one page locally would mislead.
  const serverSorts = Boolean(query.data?.meta.sort)
  const sortKey = sort.replace(/^-/, "")
  const sortState = [
    {
      id: Object.keys(sortColumns).find((id) => sortColumns[id] === sortKey) ?? "device",
      desc: sort.startsWith("-"),
    },
  ]

  const columns = useMemo<DataColumn<Device>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        mobile: "title",
        sortable: serverSorts,
        className: "max-w-72",
        value: (device) => device.name,
        cell: (device) => (
          <div className="flex min-w-0 items-center gap-1">
            <RowLink to={devicePath(org, device.uuid)} className="truncate">
              {device.name}
            </RowLink>
            {/* Shown on hover or focus; always on touch screens, which have no hover. */}
            <CopyButton
              value={device.name}
              label="device name"
              onCopied={() => toast.success("Device name copied")}
              className="shrink-0 opacity-0 focus-visible:opacity-100 in-[tr:hover]:opacity-100 pointer-coarse:opacity-100"
            />
          </div>
        ),
      },
      {
        id: "code",
        header: "Device code",
        sortable: serverSorts,
        className: "max-w-56",
        value: (device) => device.code,
        cell: (device) => (
          <CopyText
            value={device.code}
            label="device code"
            mono
            className="text-meta"
            onCopied={() => toast.success("Device code copied")}
          >
            {shortDeviceCode(device.code)}
          </CopyText>
        ),
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        value: (device) => deviceHealth(device, listFreshness).label,
        cell: (device) => <HealthStatus device={device} freshness={listFreshness} />,
      },
      {
        id: "last-seen",
        header: "Last seen",
        sortable: serverSorts,
        className: "whitespace-nowrap",
        value: (device) => device.last_seen_at,
        cell: (device) => (
          <Freshness at={device.last_seen_at} expectedSeconds={expectedSeconds(device)} />
        ),
      },
      {
        id: "profile",
        header: "Profile",
        className: "max-w-64 truncate",
        value: (device) => device.profile?.name,
        cell: (device) =>
          device.profile ? (
            <RefLink to={profilePath(org, device.profile.uuid)} title={device.profile.name}>
              {device.profile.name}
            </RefLink>
          ) : (
            <span className="text-muted-foreground">None</span>
          ),
      },
      ...(hasSites
        ? [
            {
              id: "site",
              header: "Site",
              mobile: "hidden",
              className: "max-w-48 truncate",
              value: (device) => device.site?.name,
              cell: (device) =>
                device.site ? (
                  <span title={device.site.timezone}>{device.site.name}</span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                ),
            } satisfies DataColumn<Device>,
          ]
        : []),
      {
        id: "gateway",
        header: "Gateway",
        mobile: "hidden",
        className: "max-w-56 truncate",
        value: (device) => device.candidate?.gateway.name,
        cell: (device) =>
          device.candidate ? (
            <RefLink to={gatewayPath(org, device.candidate.gateway.uuid)}>
              {device.candidate.gateway.name}
            </RefLink>
          ) : (
            <span className="text-muted-foreground">None</span>
          ),
      },
    ],
    [org, hasSites, serverSorts],
  )
  const groups = useMemo<DataGroup<Device>[]>(
    () => [
      { id: "status", label: "Status", value: (device) => deviceHealth(device, listFreshness).label },
      { id: "profile", label: "Profile", value: (device) => device.profile?.name },
      { id: "gateway", label: "Gateway", value: (device) => device.candidate?.gateway.name },
      ...(hasSites ? [{ id: "site", label: "Site", value: (device: Device) => device.site?.name }] : []),
    ],
    [hasSites],
  )

  return (
    <CollectionPage
      title="Devices"
      actions={
        capabilities.manage && (
          <Button size="sm" asChild>
            <Link to={onboardingPath(org)}>
              <PlusIcon data-icon="inline-start" />
              Add device
            </Link>
          </Button>
        )
      }
    >
      <DataTable
        id="devices"
        label="Devices"
        noun={["device", "devices"]}
        rows={query.data?.data}
        rowKey={(device) => device.uuid}
        rowLabel={(device) => device.name}
        rowHref={(device) => devicePath(org, device.uuid)}
        columns={columns}
        sort={
          serverSorts
            ? {
                value: sortState,
                onChange: (next) => {
                  const value = `${next[0]?.desc ? "-" : ""}${sortColumns[next[0]?.id ?? "device"] ?? "name"}`
                  url.set({ sort: value === "name" ? null : value })
                },
              }
            : undefined
        }
        groups={groups}
        error={query.error ? <RequestError error={query.error} /> : undefined}
        search={{
          label: "Search devices",
          placeholder: "Search name or code",
          value: search,
          onChange: (value) => url.set({ search: value }),
        }}
        filters={[
          {
            id: "status",
            label: "Status",
            multiple: true,
            options: listStatuses,
            value: statuses,
            onChange: (value: string[]) => url.set({ status: value }),
          },
          {
            id: "lifecycle",
            label: "Lifecycle",
            anyLabel: "Not archived",
            options: lifecycleOptions,
            value: lifecycle ? [lifecycle] : [],
            onChange: (value: string[]) => url.set({ lifecycle: value[0] ?? null }),
          },
          ...(profiles.data?.data.length
            ? [
                {
                  id: "profile",
                  label: "Profile",
                  options: profiles.data.data.map((p) => ({ value: p.uuid, label: p.name })),
                  value: profile ? [profile] : [],
                  onChange: (value: string[]) => url.set({ profile: value[0] ?? null }),
                },
              ]
            : []),
          ...(hasSites
            ? [
                {
                  id: "site",
                  label: "Site",
                  options: (sites.data?.data ?? []).map((s) => ({ value: s.uuid, label: s.name })),
                  value: site ? [site] : [],
                  onChange: (value: string[]) => url.set({ site: value[0] ?? null }),
                },
              ]
            : []),
        ]}
        // "All" widens the default view, so its count reads as a total, not a match.
        filtered={Boolean(search || statuses.length || (lifecycle && lifecycle !== "all") || site || profile)}
        onReset={() => url.clear(["search", "status", "lifecycle", "site", "profile"])}
        toolbar={capabilities.manage && <DiscoveryWaiting org={org} />}
        compactToolbar
        note={
          !lifecycle && (
            <>
              {hiddenArchived
                ? `${hiddenArchived.toLocaleString()} archived ${hiddenArchived === 1 ? "device" : "devices"} hidden`
                : "Archived devices hidden"}{" "}
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-meta"
                aria-label="Show archived devices"
                onClick={showArchived}
              >
                Show
              </Button>
            </>
          )
        }
        pagination={{
          page,
          pageSize,
          total: query.data?.meta.total ?? 0,
          onPageChange: (next) => url.set({ page: next > 1 ? String(next) : null }),
          onPageSizeChange: (next) => url.set({ per_page: next === 25 ? null : String(next) }),
        }}
        selectable
        exportName="devices"
        rowActions={(device) => (
          <DeviceActions
            org={org}
            device={device}
            onQuickEdit={capabilities.manage ? () => setQuickEdit(device) : undefined}
          />
        )}
        refreshSeconds={5}
        empty={
          hiddenArchived ? (
            <EmptyState
              inset
              icon={<ArchiveIcon />}
              title="No current devices"
              description={`${hiddenArchived.toLocaleString()} archived ${hiddenArchived === 1 ? "device is" : "devices are"} hidden from this list.`}
              action={
                <Button variant="outline" size="sm" onClick={showArchived}>
                  Show archived devices
                </Button>
              }
            />
          ) : (
            <EmptyState
              inset
              icon={<CpuIcon />}
              title="No devices yet"
              description={
                capabilities.manage
                  ? "Connect your first device with a profile and a guided setup."
                  : undefined
              }
              action={
                capabilities.manage && (
                  <>
                    <Button size="sm" asChild>
                      <Link to={onboardingPath(org)}>Add device</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to={discoveryPath(org)}>Open discovery</Link>
                    </Button>
                  </>
                )
              }
            />
          )
        }
      />
      {quickEdit && (
        <QuickEditDialog
          org={org}
          // The list refreshes every few seconds, so the latest row carries the current revision.
          device={query.data?.data.find((row) => row.uuid === quickEdit.uuid) ?? quickEdit}
          onClose={() => setQuickEdit(undefined)}
        />
      )}
    </CollectionPage>
  )
}

function DeviceActions({
  org,
  device,
  onQuickEdit,
}: {
  org: string
  device: Device
  onQuickEdit?: () => void
}) {
  return (
    <>
      {onQuickEdit && <DropdownMenuItem onSelect={onQuickEdit}>Quick edit</DropdownMenuItem>}
      <DropdownMenuItem asChild>
        <Link to={devicePath(org, device.uuid) + "/configuration"}>Configuration</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to={devicePath(org, device.uuid) + "/commands"}>Command log</Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() =>
          navigator.clipboard
            .writeText(device.code)
            .then(() => toast.success("Device code copied"))
            .catch(() => toast.error("Couldn't copy the device code"))
        }
      >
        Copy device code
      </DropdownMenuItem>
    </>
  )
}

type QuickEditForm = { name: string; description: string; tags: string }

/** Name, description and tags from the list; everything else stays as saved. */
function QuickEditDialog({
  org,
  device,
  onClose,
}: {
  org: string
  device: Device
  onClose: () => void
}) {
  const cache = useQueryClient()
  const form = useForm<QuickEditForm>({
    defaultValues: {
      name: device.name,
      description: device.description ?? "",
      tags: (device.tags ?? []).join(", "),
    },
  })
  const [error, setError] = useState<unknown>(null)
  const busy = form.formState.isSubmitting
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick edit</DialogTitle>
          <DialogDescription className="font-mono">{device.code}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={form.handleSubmit(async (values) => {
            setError(null)
            try {
              const saved = await api.updateDevice(org, device.uuid, {
                name: values.name.trim(),
                code: device.code,
                description: values.description.trim() || null,
                tags: values.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
                draft_revision: device.draft_revision,
              })
              cache.setQueryData(["device", org, device.uuid], saved)
              await cache.invalidateQueries({ queryKey: ["devices", org] })
              toast.success("Device updated")
              onClose()
            } catch (reason) {
              setError(reason)
              // Fetch the newer revision so saving again applies these values on top of it.
              if (reason instanceof ApiError && reason.status === 409)
                void cache.invalidateQueries({ queryKey: ["devices", org] })
            }
          })}
        >
          <FieldGroup>
            <TextField
              label="Device name"
              required
              autoFocus
              maxLength={255}
              error={fieldError(error, "name")}
              {...form.register("name", { required: true })}
            />
            <TextField
              label="Description"
              error={fieldError(error, "description")}
              {...form.register("description")}
            />
            <TextField
              label="Tags"
              placeholder="Line 2, Energy"
              help="Separate tags with commas."
              error={fieldError(error, "tags") ?? fieldError(error, "tags.0")}
              {...form.register("tags")}
            />
          </FieldGroup>
          {error instanceof ApiError && error.status === 409 ? (
            <Alert>
              <AlertDescription>
                This device changed since the list loaded. Save again to apply your changes to the
                latest version.
              </AlertDescription>
            </Alert>
          ) : (
            !fieldError(error, "name") &&
            !fieldError(error, "description") &&
            !fieldError(error, "tags") && <RequestError error={error} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.watch("name").trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Sources that report data but no device uses yet: a quiet link to Discovery in the toolbar. */
function DiscoveryWaiting({ org }: { org: string }) {
  const pending = useQuery({
    queryKey: ["discovery-directory", org, "pending-count"],
    queryFn: () => api.discoveryPage(org, { available: 1, per_page: 1 }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
  const count = pending.data?.meta?.total ?? 0
  if (!count) return null
  const label = count === 1 ? "1 source waiting in Discovery" : `${count} sources waiting in Discovery`
  // Icon and count, like the table's own toolbar buttons; the tooltip says what waits.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          asChild
          className="border-primary/40 bg-accent text-accent-foreground hover:bg-accent/80"
        >
          <Link to={discoveryPath(org)} aria-label={label}>
            <InboxIcon data-icon="inline-start" />
            <span className="tabular-nums">{count.toLocaleString()}</span>
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function RegisterDevice({
  org,
  candidate,
  onClose,
}: {
  org: string
  candidate?: string
  onClose: () => void
}) {
  const navigate = useNavigate(),
    cache = useQueryClient()
  const { setDirty } = useDirtyContext()
  const form = useForm<DeviceInput>({
    defaultValues: { name: "", code: "", serial_number: "", description: "" },
  })
  const [error, setError] = useState<unknown>(null)
  useUnsaved(form.formState.isDirty)
  return (
    <EditorSheet
      title="Register device"
      description="Choose its profile and source in Configuration next."
      dirty={form.formState.isDirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          try {
            const device = await api.createDevice(org, values)
            form.reset(values)
            await cache.invalidateQueries({ queryKey: ["devices", org] })
            onClose()
            setDirty(false)
            navigate(
              devicePath(org, device.uuid) +
                "/configuration" +
                (candidate
                  ? "?candidate=" + encodeURIComponent(candidate)
                  : ""),
            )
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            <TextField
              label="Device name"
              required
              {...form.register("name")}
              error={fieldError(error, "name")}
            />
            <TextField
              label="Device code"
              required
              {...form.register("code")}
              error={fieldError(error, "code")}
              help="Unique in this organization. Use letters, numbers, dots, dashes, or underscores."
            />
            <TextField
              label="Serial number"
              {...form.register("serial_number")}
            />
            <TextField label="Description" {...form.register("description")} />
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={form.formState.isDirty}
          busy={form.formState.isSubmitting}
          onCancel={onClose}
          label="Register device"
        />
      </form>
    </EditorSheet>
  )
}
