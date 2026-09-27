import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { DeviceDetail } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import { EllipsisIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError, Confirm } from "../components/forms"
import {
  Age,
  configurationRevision,
  DeviceStatus,
  devicePath,
  deviceStatus,
  useDeviceOrganization,
} from "./shared"
import { useDeviceLifecycle } from "./DeviceLifecycleAction"
import { lifecycleStorageKey, newerDevice, reconcileDevice } from "./lifecycle"
import { ConfigurationSection } from "./ConfigurationSection"
import { MeasurementsSection } from "./MeasurementsSection"
import { CommandsSection } from "./CommandsSection"
import { DeviceOverview } from "./DeviceOverview"
import { AddToDashboard, EditDetails } from "./DeviceActions"
import { DeviceControls } from "../controls/DeviceControls"

const HistorySection = lazy(() => import("./HistorySection"))
const sections = {
  overview: "Overview",
  measurements: "Measurements",
  history: "History",
  configuration: "Configuration",
  controls: "Controls",
  commands: "Command log",
} as const
export type DeviceOperation = <T>(operation: () => Promise<T>) => Promise<T>
export function DeviceWorkspace() {
  const { org, capabilities } = useDeviceOrganization(),
    { deviceUuid = "", section = "overview" } = useParams(),
    navigate = useNavigate()
  const cache = useQueryClient(),
    lock = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [unconfirmed, setUnconfirmed] = useState(() =>
      Boolean(sessionStorage.getItem(lifecycleStorageKey(org, deviceUuid))),
    )
  const key = ["device", org, deviceUuid]
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const incoming = await api.device(org, deviceUuid)
      return newerDevice(cache.getQueryData<DeviceDetail>(key), incoming)
    },
    refetchInterval: (query) =>
      unconfirmed || query.state.data?.deployment_status === "pending"
        ? 1000
        : 5000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchIntervalInBackground: false,
  })
  const pendingRequest = (() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(lifecycleStorageKey(org, deviceUuid)) ?? "null",
      ) as { operation_uuid: string } | null
    } catch {
      return null
    }
  })()
  const recovery = useQuery({
    queryKey: [
      "device-operation",
      org,
      deviceUuid,
      pendingRequest?.operation_uuid,
    ],
    enabled: Boolean(pendingRequest),
    queryFn: () =>
      api.deviceOperation(org, deviceUuid, pendingRequest!.operation_uuid),
    retry: false,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  })
  useEffect(() => {
    if (!recovery.data) return
    reconcileDevice(cache, org, recovery.data.data)
    if (recovery.data.operation.status !== "pending") {
      sessionStorage.removeItem(lifecycleStorageKey(org, deviceUuid))
      setUnconfirmed(false)
    }
  }, [recovery.data, cache, org, deviceUuid])
  const lastState = useRef("")
  useEffect(() => {
    if (!query.data) return
    const stamp =
      query.data.deployment_generation + ":" + query.data.state_revision
    if (stamp !== lastState.current) {
      lastState.current = stamp
      reconcileDevice(cache, org, query.data)
    }
  }, [query.data, cache, org])
  const run: DeviceOperation = useCallback(
    async (operation) => {
      if (lock.current || unconfirmed)
        throw new Error("Wait for the current request to be confirmed.")
      lock.current = true
      setBusy(true)
      setError(null)
      await cache.cancelQueries({ queryKey: ["device", org, deviceUuid] })
      try {
        const result = await operation()
        if (
          result &&
          typeof result === "object" &&
          "draft_revision" in result &&
          "uuid" in result
        ) {
          reconcileDevice(cache, org, result as unknown as DeviceDetail)
        }
        void cache.invalidateQueries({ queryKey: ["device", org, deviceUuid] })
        return result
      } catch (reason) {
        setError(reason)
        throw reason
      } finally {
        lock.current = false
        setBusy(false)
      }
    },
    [org, deviceUuid, cache, unconfirmed],
  )
  const back = { to: devicePath(org), label: "Devices" }
  if (query.isPending)
    return (
      <>
        <PageHeader title="Device" back={back} />
        <div className="p-4 md:p-6">
          <Skeleton className="h-80 w-full" />
        </div>
      </>
    )
  if (!query.data)
    return (
      <>
        <PageHeader title="Device" back={back} />
        <div className="flex flex-col items-start gap-3 p-4 md:p-6">
          <RequestError error={query.error} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
            <Button asChild variant="ghost">
              <Link to={back.to}>Back to devices</Link>
            </Button>
          </div>
        </div>
      </>
    )
  return (
    <Workspace
      org={org}
      device={query.data}
      section={section in sections ? section : "overview"}
      onSection={(value) => navigate(devicePath(org, deviceUuid) + "/" + value)}
      capabilities={capabilities}
      run={run}
      busy={busy}
      unconfirmed={unconfirmed}
      onUnconfirmed={setUnconfirmed}
      error={error ?? query.error}
    />
  )
}

function Workspace({
  org,
  device,
  section,
  onSection,
  capabilities,
  run,
  busy,
  unconfirmed,
  onUnconfirmed,
  error,
}: {
  org: string
  device: DeviceDetail
  section: string
  onSection: (value: string) => void
  capabilities: ReturnType<typeof useDeviceOrganization>["capabilities"]
  run: DeviceOperation
  busy: boolean
  unconfirmed: boolean
  onUnconfirmed: (value: boolean) => void
  error: unknown
}) {
  const locked = busy || unconfirmed || device.deployment_status === "pending"
  const lifecycle = useDeviceLifecycle({
    org,
    device,
    disabled: locked,
    onUnconfirmed,
  })
  const [dialog, setDialog] = useState<"details" | "dashboard" | "archive" | null>(
    null,
  )
  const archived = device.lifecycle === "archived"
  const archiveReason = locked
    ? "Wait for the current request to finish."
    : device.applied_configuration_uuid || device.desired_configuration_uuid
      ? "Deactivate the device and wait for the runtime to confirm first."
      : undefined
  const menu = [
    capabilities.manage && !archived,
    capabilities.activate && lifecycle.action,
  ].some(Boolean)
  return (
    <Tabs value={section} onValueChange={onSection} className="gap-0">
      <PageHeader
        title={device.name}
        back={{ to: devicePath(org), label: "Devices" }}
        meta={<span className="font-mono">{device.code}</span>}
        actions={
          <>
            {capabilities.manage && !archived && (
              <Button variant="outline" size="sm" onClick={() => setDialog("dashboard")}>
                <PlusIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Add to dashboard</span>
              </Button>
            )}
            {menu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="Device actions">
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {capabilities.manage && !archived && (
                    <DropdownMenuItem onSelect={() => setDialog("details")}>
                      Edit details
                    </DropdownMenuItem>
                  )}
                  {capabilities.activate && lifecycle.action && (
                    <MenuAction
                      label={lifecycle.action.label}
                      reason={lifecycle.action.reason}
                      destructive={lifecycle.action.destructive}
                      onSelect={lifecycle.action.open}
                    />
                  )}
                  {capabilities.manage && !archived && (
                    <>
                      <DropdownMenuSeparator />
                      <MenuAction
                        label="Archive device"
                        reason={archiveReason}
                        destructive
                        onSelect={() => setDialog("archive")}
                      />
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        <StateLine device={device} />
        <div className="-mx-1 w-full overflow-x-auto scrollbar-none">
          <TabsList variant="line" className="justify-start px-1">
            {Object.entries(sections).map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="flex-none">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </PageHeader>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <RequestError error={error} />
        {device.diagnostic && (
          <Alert>
            <AlertTitle>Device needs attention</AlertTitle>
            <AlertDescription>{device.diagnostic}</AlertDescription>
          </Alert>
        )}
        {lifecycle.status}
        <TabsContent value="overview">
          <DeviceOverview org={org} device={device} editable={capabilities.manage} />
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
            busy={locked}
          />
        </TabsContent>
        <TabsContent value="controls">
          <DeviceControls
            org={org}
            deviceUuid={device.uuid}
            allowed={capabilities.command && !unconfirmed && !busy}
          />
        </TabsContent>
        <TabsContent value="commands">
          <CommandsSection
            org={org}
            device={device}
            allowed={capabilities.command && !unconfirmed}
            run={run}
            busy={locked}
          />
        </TabsContent>
      </div>
      {lifecycle.dialog}
      {dialog === "details" && (
        <EditDetails
          org={org}
          device={device}
          run={run}
          busy={locked}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "dashboard" && (
        <AddToDashboard org={org} device={device} onClose={() => setDialog(null)} />
      )}
      <Confirm
        open={dialog === "archive"}
        title="Archive this device?"
        description="The record becomes read-only. Configuration and command history remain available."
        action="Archive device"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await run(() =>
            api.deviceAction(org, device.uuid, "archive", device.draft_revision),
          )
        }}
      />
    </Tabs>
  )
}

/** A menu item that stays visible when unavailable and says why. */
function MenuAction({
  label,
  reason,
  destructive,
  onSelect,
}: {
  label: string
  reason?: string
  destructive?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      disabled={Boolean(reason)}
      variant={destructive ? "destructive" : "default"}
      className="flex-col items-start gap-0"
      onSelect={onSelect}
    >
      {label}
      {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
    </DropdownMenuItem>
  )
}

function StateLine({ device }: { device: DeviceDetail }) {
  const applied = configurationRevision(device, device.applied_configuration_uuid),
    desired = configurationRevision(device, device.desired_configuration_uuid),
    working = configurationRevision(device, device.last_applied_configuration_uuid)
  const [tone] = deviceStatus(device.deployment_status)
  const configuration =
    device.deployment_status === "applied"
      ? `Configuration applied rev ${applied ?? ""}`
      : device.deployment_status === "pending"
        ? `Configuration rev ${desired ?? ""} pending`
        : device.deployment_status === "failed"
          ? "Configuration failed"
          : working !== undefined
            ? `Last working configuration rev ${working}`
            : "Not configured"
  const dot = (
    <span aria-hidden="true" className="text-muted-foreground">
      ·
    </span>
  )
  return (
    <p className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm">
      <DeviceStatus value={device.lifecycle} />
      {device.lifecycle !== "deactivated" && device.lifecycle !== "archived" && (
        <>
          {dot}
          <DeviceStatus value={device.presence} />
        </>
      )}
      {dot}
      <StatusMark tone={tone}>{configuration}</StatusMark>
      {dot}
      <span className="text-muted-foreground">
        Last seen <Age value={device.last_seen_at} never="never" />
      </span>
    </p>
  )
}
