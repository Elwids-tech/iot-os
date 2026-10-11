import { useMemo, useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import type { Device, DeviceInput } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  DataTable,
  RefLink,
  RowLink,
  type DataColumn,
  type DataGroup,
} from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Freshness } from "@iot-os/ui/components/freshness"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { CpuIcon, InboxIcon, PlusIcon } from "lucide-react"
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
import { deviceHealth, RECENT_DATA_MS, shortDeviceCode } from "./model"

const lifecycles = ["registered", "active", "deactivated", "archived"] as const
const lifecycleLabels = {
  registered: "Registered",
  active: "Active",
  deactivated: "Deactivated",
  archived: "Archived",
}
/** Lists show presence in Status and how recent the data is in Last seen, so "no recent data" never merges into one mark. */
const listFreshness = { recentMs: Number.POSITIVE_INFINITY }
/** An active, online device that has been quiet for longer than RECENT_DATA_MS reads late. */
const expectedSeconds = (device: Device) =>
  device.lifecycle === "active" && device.presence === "online" ? RECENT_DATA_MS / 2000 : null

/** Sortable columns and the devices API sort each one maps to. */
const sortColumns: Record<string, string> = { device: "name", "last-seen": "last_seen" }

export function DeviceDirectory() {
  const { org, capabilities } = useDeviceOrganization()
  const url = useUrlState()
  const search = url.get("search"),
    lifecycle = url.get("lifecycle"),
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
  const query = useQuery({
    queryKey: ["devices", org, { search, lifecycle, site, profile, sort, page, pageSize }],
    queryFn: () =>
      api.devices(org, {
        search,
        lifecycle,
        site_uuid: site || undefined,
        profile_uuid: profile || undefined,
        sort: sort === "name" ? undefined : sort,
        page,
        per_page: pageSize,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  // One light request per lifecycle for the view counts; "All" is their sum.
  const counts = useQuery({
    queryKey: ["devices", org, "counts", search],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          lifecycles.map(async (value) => [
            value,
            (await api.devices(org, { search, lifecycle: value, per_page: 1 }))
              .meta.total,
          ]),
        ),
      ) as Record<(typeof lifecycles)[number], number>,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  })
  const all = counts.data
    ? lifecycles.reduce((sum, value) => sum + counts.data[value], 0)
    : undefined
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
          <>
            <RowLink to={devicePath(org, device.uuid)} className="block truncate">
              {device.name}
            </RowLink>
            <DeviceCode code={device.code} />
          </>
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
        views={{
          label: "Lifecycle",
          value: lifecycle || "all",
          onChange: (value) => url.set({ lifecycle: value === "all" ? null : value }),
          options: [
            { value: "all", label: "All", count: all },
            ...lifecycles.map((value) => ({
              value,
              label: lifecycleLabels[value],
              count: counts.data?.[value],
            })),
          ],
        }}
        search={{
          label: "Search devices",
          placeholder: "Search name or code",
          value: search,
          onChange: (value) => url.set({ search: value }),
        }}
        filters={[
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
        filtered={Boolean(search || lifecycle || site || profile)}
        onReset={() => url.clear(["search", "lifecycle", "site", "profile"])}
        toolbar={capabilities.manage && <DiscoveryWaiting org={org} />}
        pagination={{
          page,
          pageSize,
          total: query.data?.meta.total ?? 0,
          onPageChange: (next) => url.set({ page: next > 1 ? String(next) : null }),
          onPageSizeChange: (next) => url.set({ per_page: next === 25 ? null : String(next) }),
        }}
        selectable
        exportName="devices"
        rowActions={(device) => <DeviceActions org={org} device={device} />}
        refreshSeconds={5}
        empty={
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
        }
      />
    </CollectionPage>
  )
}

function DeviceActions({ org, device }: { org: string; device: Device }) {
  return (
    <>
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

/** Device code; platform-generated "device-<uuid>" codes are shortened with the full code on hover. */
function DeviceCode({ code }: { code: string }) {
  const short = shortDeviceCode(code)
  return (
    <p
      className="truncate font-mono text-meta text-muted-foreground"
      title={short === code ? undefined : code}
    >
      {short}
    </p>
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
  return (
    <Button variant="outline" size="sm" asChild className="border-primary/40 bg-accent text-accent-foreground hover:bg-accent/80">
      <Link to={discoveryPath(org)}>
        <InboxIcon data-icon="inline-start" />
        {count === 1 ? "1 source waiting in Discovery" : `${count} sources waiting in Discovery`}
      </Link>
    </Button>
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
