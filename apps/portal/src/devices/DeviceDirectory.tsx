import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useForm } from "react-hook-form"
import type { Device, DeviceInput } from "@iot-os/api-client"
import {
  Alert,
  AlertAction,
  AlertTitle,
} from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Card } from "@iot-os/ui/components/card"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { InboxIcon, PlusIcon, XIcon } from "lucide-react"
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
  Age,
  devicePath,
  DevicePages,
  DeviceEmpty,
  discoveryPath,
  gatewayPath,
  HealthBadge,
  profilePath,
  useDeviceOrganization,
} from "./shared"
import { shortDeviceCode } from "./model"

const lifecycles = ["registered", "active", "deactivated", "archived"] as const
const lifecycleLabels = {
  registered: "Registered",
  active: "Active",
  deactivated: "Deactivated",
  archived: "Archived",
}

export function DeviceDirectory() {
  const { org, capabilities } = useDeviceOrganization()
  const [params, setParams] = useSearchParams()
  const [create, setCreate] = useState(false)
  const search = params.get("search") ?? "",
    lifecycle = params.get("lifecycle") ?? ""
  const query = useQuery({
    queryKey: ["devices", org, params.toString()],
    queryFn: () =>
      api.devices(org, {
        search,
        lifecycle,
        page: Number(params.get("page") ?? 1),
      }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  // One light request per lifecycle for the filter counts; "All" is their sum.
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
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete("page")
    setParams(next, { replace: true })
  }
  const total = query.data?.meta.total
  const filtered = Boolean(search || lifecycle)
  const all = counts.data
    ? lifecycles.reduce((sum, value) => sum + counts.data[value], 0)
    : undefined
  const devices = query.data?.data ?? []
  return (
    <>
      <PageHeader
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
        <Input
          aria-label="Search devices"
          placeholder="Search name or code"
          className="h-8 w-full sm:w-64"
          value={search}
          onChange={(e) => filter("search", e.target.value)}
        />
        <div className="max-w-full overflow-x-auto scrollbar-none">
          <ToggleGroup
            type="single"
            size="sm"
            aria-label="Lifecycle"
            value={lifecycle || "all"}
            onValueChange={(value) =>
              value && filter("lifecycle", value === "all" ? "" : value)
            }
          >
            <ToggleGroupItem value="all">
              All
              <span className="font-normal tabular-nums">{all ?? ""}</span>
            </ToggleGroupItem>
            {lifecycles.map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {lifecycleLabels[value]}
                <span className="font-normal tabular-nums">
                  {counts.data?.[value] ?? ""}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {total !== undefined && (
          <span className="ml-auto text-sm text-muted-foreground" role="status">
            {total === 1 ? "1 device" : `${total} devices`}
            {filtered ? " match" : ""}
          </span>
        )}
      </PageHeader>
      <div className="p-4 md:p-6">
        {capabilities.manage && <PendingSources org={org} />}
        <RequestError error={query.error} />
        {query.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : devices.length ? (
          <>
            <div className="max-md:hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>Gateway</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.uuid}>
                      <TableCell className="max-w-72">
                        <Link
                          className="block truncate font-medium text-primary underline-offset-4 hover:underline"
                          to={devicePath(org, device.uuid)}
                        >
                          {device.name}
                        </Link>
                        <DeviceCode code={device.code} />
                      </TableCell>
                      <TableCell>
                        <HealthBadge device={device} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Age value={device.last_seen_at} />
                      </TableCell>
                      <TableCell className="max-w-64 truncate">
                        {device.profile ? (
                          <Link
                            className="text-primary underline-offset-4 hover:underline"
                            to={profilePath(org, device.profile.uuid)}
                            title={device.profile.name}
                          >
                            {device.profile.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-56 truncate">
                        {device.candidate ? (
                          <Link
                            className="text-primary underline-offset-4 hover:underline"
                            to={gatewayPath(org, device.candidate.gateway.uuid)}
                          >
                            {device.candidate.gateway.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul aria-label="Devices" className="flex flex-col gap-2 md:hidden">
              {devices.map((device) => (
                <li key={device.uuid}>
                  <DeviceCard org={org} device={device} />
                </li>
              ))}
            </ul>
          </>
        ) : filtered ? (
          <DeviceEmpty title="No matching devices">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              Clear filters
            </Button>
          </DeviceEmpty>
        ) : (
          <DeviceEmpty
            title="No devices yet"
            description={
              capabilities.manage
                ? "Connect your first device with a profile and a guided setup."
                : undefined
            }
          >
            {capabilities.manage && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" asChild>
                  <Link to={onboardingPath(org)}>Add device</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to={discoveryPath(org)}>Open discovery</Link>
                </Button>
              </div>
            )}
          </DeviceEmpty>
        )}
        <DevicePages
          meta={query.data?.meta}
          label="Devices"
          onPage={(page) => {
            const next = new URLSearchParams(params)
            next.set("page", String(page))
            setParams(next)
          }}
        />
      </div>
      {create && <RegisterDevice org={org} onClose={() => setCreate(false)} />}
    </>
  )
}

/** Device code; platform-generated "device-<uuid>" codes are shortened with the full code on hover. */
function DeviceCode({ code }: { code: string }) {
  const short = shortDeviceCode(code)
  return (
    <p
      className="truncate font-mono text-xs text-muted-foreground"
      title={short === code ? undefined : code}
    >
      {short}
    </p>
  )
}

/** Phone layout: the whole card opens the device. */
function DeviceCard({ org, device }: { org: string; device: Device }) {
  return (
    <Card size="sm" className="relative gap-1 px-3 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Link
          className="min-w-0 truncate font-medium text-primary outline-none after:absolute after:inset-0"
          to={devicePath(org, device.uuid)}
        >
          {device.name}
        </Link>
        <HealthBadge device={device} className="shrink-0" />
      </div>
      <DeviceCode code={device.code} />
      <p className="flex min-w-0 flex-wrap gap-x-2 text-muted-foreground">
        <span className="whitespace-nowrap">
          Last seen <Age value={device.last_seen_at} never="never" />
        </span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">
          {device.profile ? device.profile.name : "No profile"}
        </span>
      </p>
    </Card>
  )
}

/** Sources that report data but no device uses yet; dismissed per session until more arrive. */
function PendingSources({ org }: { org: string }) {
  const key = "discovery-review-dismissed:" + org
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Number(sessionStorage.getItem(key) ?? 0)
    } catch {
      return 0
    }
  })
  const pending = useQuery({
    queryKey: ["discovery-directory", org, "pending-count"],
    queryFn: () =>
      api.discoveryPage(org, { available: 1, per_page: 1 }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
  const count = pending.data?.meta?.total ?? 0
  if (count <= dismissed) return null
  return (
    <Alert className="mb-4 has-data-[slot=alert-action]:pr-32">
      <InboxIcon />
      <AlertTitle>
        {count === 1
          ? "1 data source has reported data but isn't a device yet"
          : `${count} data sources have reported data but aren't devices yet`}
      </AlertTitle>
      <AlertAction className="flex items-center gap-1">
        <Button size="xs" variant="outline" asChild>
          <Link to={discoveryPath(org)}>Review</Link>
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Dismiss for this session"
          onClick={() => {
            setDismissed(count)
            try {
              sessionStorage.setItem(key, String(count))
            } catch {
              // Session storage can be unavailable; the banner still hides until reload.
            }
          }}
        >
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
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
