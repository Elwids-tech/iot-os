import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useForm } from "react-hook-form"
import type { DeviceInput } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
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
import { PlusIcon } from "lucide-react"
import { api } from "../lib/api"
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
  DeviceStatus,
  DeviceEmpty,
  gatewayPath,
  profilePath,
  useDeviceOrganization,
} from "./shared"

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
  return (
    <>
      <PageHeader
        title="Devices"
        actions={
          capabilities.manage && (
            <Button size="sm" onClick={() => setCreate(true)}>
              <PlusIcon data-icon="inline-start" />
              Register device
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
        <div className="max-w-full overflow-x-auto">
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
        <RequestError error={query.error} />
        {query.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : query.data?.data.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Configuration</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((device) => (
                <TableRow key={device.uuid}>
                  <TableCell>
                    <Link
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      to={devicePath(org, device.uuid)}
                    >
                      {device.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">
                      {device.code}
                    </p>
                  </TableCell>
                  <TableCell>
                    <DeviceStatus value={device.lifecycle} />
                  </TableCell>
                  <TableCell>
                    {device.lifecycle !== "deactivated" && (
                      <DeviceStatus value={device.presence} />
                    )}
                  </TableCell>
                  <TableCell>
                    {device.lifecycle !== "deactivated" ||
                    device.deployment_status === "pending" ? (
                      <DeviceStatus value={device.deployment_status} />
                    ) : null}
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
                  <TableCell className="text-right">
                    <Age value={device.last_seen_at} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
                ? "Register a device, or onboard a source from Discovery."
                : undefined
            }
          >
            {capabilities.manage && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setCreate(true)}>
                  Register device
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/organizations/${encodeURIComponent(org)}/discovery`}>
                    Open discovery
                  </Link>
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
