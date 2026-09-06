import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import type { DeviceDetail, DeviceInput } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@iot-os/ui/components/card"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { RequestError, TextField, SaveBar, Confirm } from "../components/forms"
import {
  DeviceStatus,
  devicePath,
  formatTime,
  useDeviceOrganization,
} from "./shared"
import { ConfigurationSection } from "./ConfigurationSection"
import { MeasurementsSection } from "./MeasurementsSection"
import { CommandsSection } from "./CommandsSection"

const HistorySection = lazy(() => import("./HistorySection"))
const sections = [
  "overview",
  "measurements",
  "history",
  "configuration",
  "commands",
] as const
export type DeviceOperation = <T>(operation: () => Promise<T>) => Promise<T>
export function DeviceWorkspace() {
  const { org, capabilities } = useDeviceOrganization(),
    { deviceUuid = "", section = "overview" } = useParams(),
    navigate = useNavigate()
  const cache = useQueryClient(),
    lock = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [refreshRequired, setRefreshRequired] = useState(false)
  const key = ["device", org, deviceUuid]
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.device(org, deviceUuid),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const run: DeviceOperation = useCallback(
    async (operation) => {
      if (lock.current || refreshRequired)
        throw new Error("Refresh the device before making another change.")
      lock.current = true
      setBusy(true)
      setError(null)
      try {
        const result = await operation()
        try {
          const fresh = await api.device(org, deviceUuid)
          cache.setQueryData(["device", org, deviceUuid], fresh)
        } catch (reason) {
          setRefreshRequired(true)
          throw reason
        }
        return result
      } catch (reason) {
        setError(reason)
        throw reason
      } finally {
        lock.current = false
        setBusy(false)
      }
    },
    [org, deviceUuid, cache, refreshRequired],
  )
  if (query.isPending) return <Skeleton className="h-80 w-full" />
  if (!query.data) return <RequestError error={query.error} />
  const device = query.data,
    activeSection = sections.includes(section as (typeof sections)[number])
      ? section
      : "overview"
  return (
    <div className="flex flex-col gap-6">
      <Link
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        to={devicePath(org)}
      >
        Devices / {device.code}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{device.name}</h1>
          <p className="text-muted-foreground">
            {device.description || "Device workspace"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DeviceStatus value={device.lifecycle} />
          <DeviceStatus value={device.presence} />
          <DeviceStatus value={device.deployment_status} />
        </div>
      </div>
      <RequestError error={error ?? query.error} />
      {refreshRequired && (
        <Alert>
          <AlertTitle>Refresh required</AlertTitle>
          <AlertDescription>
            A change was saved, but its refreshed state could not be loaded.
            Further changes are paused.
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const fresh = await api.device(org, deviceUuid)
                  cache.setQueryData(key, fresh)
                  setRefreshRequired(false)
                  setError(null)
                } catch (reason) {
                  setError(reason)
                }
              }}
            >
              Reload device
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {device.diagnostic && (
        <Alert>
          <AlertTitle>Device needs attention</AlertTitle>
          <AlertDescription>{device.diagnostic}</AlertDescription>
        </Alert>
      )}
      <Tabs
        value={activeSection}
        onValueChange={(value) =>
          navigate(devicePath(org, deviceUuid) + "/" + value)
        }
      >
        <TabsList className="w-full flex-wrap gap-1 group-data-[orientation=horizontal]/tabs:h-auto sm:w-fit">
          {sections.map((s) => (
            <TabsTrigger key={s} value={s} className="h-9">
              {s[0].toUpperCase() + s.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <DeviceOverview
            key={deviceUuid}
            org={org}
            device={device}
            editable={capabilities.manage}
            canActivate={capabilities.activate}
            run={run}
            busy={busy || refreshRequired}
          />
        </TabsContent>
        <TabsContent value="measurements">
          <MeasurementsSection org={org} device={device} />
        </TabsContent>
        <TabsContent value="history">
          <Suspense fallback={<Skeleton className="h-80 w-full" />}>
            <HistorySection org={org} device={device} />
          </Suspense>
        </TabsContent>
        <TabsContent value="configuration">
          <ConfigurationSection
            org={org}
            device={device}
            editable={capabilities.manage}
            canActivate={capabilities.activate}
            run={run}
            busy={busy || refreshRequired}
          />
        </TabsContent>
        <TabsContent value="commands">
          <CommandsSection
            org={org}
            device={device}
            allowed={capabilities.command}
            run={run}
            busy={busy || refreshRequired}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DeviceOverview({
  org,
  device,
  editable,
  canActivate,
  run,
  busy,
}: {
  org: string
  device: DeviceDetail
  editable: boolean
  canActivate: boolean
  run: DeviceOperation
  busy: boolean
}) {
  const savedValues = (d: DeviceDetail): DeviceInput => ({
    name: d.name,
    code: d.code,
    serial_number: d.serial_number ?? "",
    description: d.description ?? "",
  })
  const form = useForm<DeviceInput>({ defaultValues: savedValues(device) }),
    [revision, setRevision] = useState(device.draft_revision),
    [action, setAction] = useState<"deactivate" | "archive" | null>(null)
  const dirty = form.formState.isDirty
  useUnsaved(dirty)
  useEffect(() => {
    if (!dirty) {
      form.reset(savedValues(device))
      setRevision(device.draft_revision)
    }
  }, [device.draft_revision, dirty, form])
  return (
    <div className="grid items-start gap-6 pt-4 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Device identity</CardTitle>
          <CardDescription>
            Its identity stays the same when source sessions or profile
            revisions change.
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            try {
              const result = await run(() =>
                api.updateDevice(org, device.uuid, {
                  ...values,
                  draft_revision: revision,
                }),
              )
              form.reset(savedValues(result))
              setRevision(result.draft_revision)
            } catch {}
          })}
        >
          <CardContent>
            <FieldGroup>
              <TextField
                label="Device name"
                required
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("name")}
              />
              <TextField
                label="Device code"
                required
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("code")}
              />
              <TextField
                label="Serial number"
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("serial_number")}
              />
              <TextField
                label="Description"
                disabled={!editable || device.lifecycle === "archived"}
                {...form.register("description")}
              />
              {dirty && device.draft_revision !== revision && (
                <Alert>
                  <AlertTitle>Newer saved values are available</AlertTitle>
                  <AlertDescription>
                    The saved name is “{device.name}” and code is “{device.code}
                    ”. Your form is retained.
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => {
                        form.reset(savedValues(device))
                        setRevision(device.draft_revision)
                      }}
                    >
                      Use saved values
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          </CardContent>
          {editable && device.lifecycle !== "archived" && (
            <CardFooter className="mt-5 p-0">
              <SaveBar
                dirty={dirty}
                busy={busy}
                onCancel={() => {
                  form.reset(savedValues(device))
                  setRevision(device.draft_revision)
                }}
              />
            </CardFooter>
          )}
        </form>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Connection and configuration</CardTitle>
            <CardDescription>
              Registration, connectivity, and runtime application are tracked
              separately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-3 text-sm">
              <dt>Gateway</dt>
              <dd>{device.candidate?.gateway.name ?? "Not assigned"}</dd>
              <dt>Source</dt>
              <dd>
                {device.candidate
                  ? device.candidate.source_device_id ||
                    "Edge Node measurements"
                  : "Not assigned"}
              </dd>
              <dt>Last seen</dt>
              <dd>{formatTime(device.last_seen_at)}</dd>
              <dt>Applied revision</dt>
              <dd>
                {device.configurations.find(
                  (c) => c.uuid === device.applied_configuration_uuid,
                )?.revision ?? "None"}
              </dd>
              <dt>Requested revision</dt>
              <dd>
                {device.configurations.find(
                  (c) => c.uuid === device.desired_configuration_uuid,
                )?.revision ?? "None"}
              </dd>
            </dl>
          </CardContent>
        </Card>
        {device.lifecycle !== "archived" && (
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle actions</CardTitle>
              <CardDescription>
                Deactivate first to stop runtime processing. Archiving preserves
                configuration and command history.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {canActivate && device.applied_configuration_uuid && (
                <Button
                  variant="outline"
                  disabled={
                    busy || dirty || device.deployment_status === "pending"
                  }
                  onClick={() => setAction("deactivate")}
                >
                  Deactivate device
                </Button>
              )}
              {editable && (
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    dirty ||
                    Boolean(
                      device.applied_configuration_uuid ||
                        device.desired_configuration_uuid,
                    ) ||
                    device.deployment_status === "pending"
                  }
                  onClick={() => setAction("archive")}
                >
                  Archive device
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <Confirm
        open={Boolean(action)}
        title={
          action === "archive"
            ? "Archive this device?"
            : "Deactivate this device?"
        }
        description={
          action === "archive"
            ? "The record becomes read-only. Configuration and command history remain available."
            : "The runtime will stop processing this device after acknowledging the request. Pending command outcomes may remain uncertain."
        }
        action={action === "archive" ? "Archive device" : "Deactivate device"}
        onClose={() => setAction(null)}
        onConfirm={async () => {
          if (action)
            await run(() =>
              api.deviceAction(org, device.uuid, action, device.draft_revision),
            )
        }}
      />
    </div>
  )
}
