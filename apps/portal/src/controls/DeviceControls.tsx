import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  DashboardControlColumns,
  DeviceCommand,
  Measurement,
} from "@iot-os/api-client"
import { api } from "../lib/api"
import { telemetryRequest } from "../dashboards/requests"
import { useDevices } from "../dashboards/panelData"
import { useUnsavedContribution } from "../lib/unsaved"
import { RequestError } from "../components/forms"
import { formatValue } from "../devices/shared"
import { ParameterControl } from "./ParameterControl"
import {
  controlSpec,
  outstandingCommand,
  writableParameters,
  type ControlValue,
} from "./model"

type Snapshot = {
  commands: DeviceCommand[]
  latest: {
    data: Measurement[]
    presence: string
    configuration_uuid?: string
  }
}
const sending = new Set<string>()
export function DeviceControls({
  org,
  deviceUuid,
  allowed,
  preview = false,
  sources,
  columns,
}: {
  org: string
  deviceUuid: string
  allowed: boolean
  preview?: boolean
  sources?: Array<{ parameter_uuid: string; label?: string }>
  columns?: DashboardControlColumns
}) {
  const cache = useQueryClient(),
    key = ["device-controls", org, deviceUuid]
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  useUnsavedContribution(Object.values(dirty).some(Boolean))
  // Device metadata (profile, lifecycle, deployment) changes slowly and is
  // shared with dashboard panels; commands and reported state poll every
  // second. Each request takes its own slot in the shared queue.
  const deviceQuery = useDevices(org, [deviceUuid], 5000)(deviceUuid)
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<Snapshot> => {
      const [commands, latest] = await Promise.all([
        telemetryRequest(signal, () =>
          api.deviceCommands(org, deviceUuid, signal),
        ),
        telemetryRequest(signal, () =>
          api.deviceLatest(org, deviceUuid, signal),
        ),
      ])
      return { commands, latest }
    },
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
  })
  const snapshot = query.data,
    device = deviceQuery?.data
  useEffect(() => {
    setDirty({})
  }, [device?.applied_configuration_uuid])
  const parameters = writableParameters(device)
  const selected =
    sources ??
    parameters.map((p) => ({ parameter_uuid: p.uuid, label: p.label }))
  const resolvedColumns = columns ?? (sources ? 1 : "auto")
  // Presence comes from the 1 s runtime read; the device record lags it.
  const ready =
    allowed &&
    !preview &&
    !query.isError &&
    !deviceQuery?.isError &&
    device?.lifecycle === "active" &&
    ["applied", "failed"].includes(device.deployment_status) &&
    snapshot?.latest.presence === "online" &&
    snapshot?.latest.configuration_uuid === device.applied_configuration_uuid
  async function send(parameter: string, value: ControlValue) {
    const slot = `${org}:${deviceUuid}:${parameter}`
    if (sending.has(slot))
      throw new Error("A change for this parameter is already being sent.")
    if (!ready || !device?.applied_configuration_uuid)
      throw new Error("Wait for a fresh, online device state.")
    sending.add(slot)
    try {
      await cache.cancelQueries({ queryKey: key })
      const command = await api.sendDeviceCommand(org, deviceUuid, {
        configuration_uuid: device.applied_configuration_uuid,
        parameter_uuid: parameter,
        value,
        idempotency_key: crypto.randomUUID(),
      })
      cache.setQueryData<Snapshot>(key, (previous) =>
        previous
          ? {
              ...previous,
              commands: [
                command,
                ...previous.commands.filter((c) => c.uuid !== command.uuid),
              ],
            }
          : previous,
      )
      void cache.invalidateQueries({
        queryKey: ["device-commands", org, deviceUuid],
      })
    } finally {
      sending.delete(slot)
      void cache.invalidateQueries({ queryKey: key })
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <RequestError error={query.error ?? deviceQuery?.error} />
      {(query.isPending || deviceQuery?.isPending) && (
        <p role="status">Loading controls…</p>
      )}
      {preview && (
        <p className="text-sm text-muted-foreground">
          Preview only. Controls are available after leaving dashboard editing.
        </p>
      )}
      {!preview && !ready && snapshot && (
        <p role="status" className="text-sm text-muted-foreground">
          {!allowed
            ? "Your role can view device state. Sending requires command permission."
            : "Sending is unavailable. Waiting for an online device with fresh, compatible state."}
        </p>
      )}
      {!selected.length && snapshot && (
        <p>No writable state parameters are configured.</p>
      )}
      <div className="device-controls-container">
        <div className="device-controls-grid" data-columns={resolvedColumns}>
        {selected.map((source) => {
          const parameter = parameters.find(
            (p) => p.uuid === source.parameter_uuid,
          )
          if (!parameter)
            return (
              <p key={source.parameter_uuid}>
                {source.label ?? "Parameter"}: control unavailable in the
                applied configuration.
              </p>
            )
          const reading = snapshot?.latest.data.find(
            (r) => r.parameter_uuid === parameter.uuid,
          )
          const command = snapshot?.commands.find(
            (c) =>
              c.parameter_uuid === parameter.uuid &&
              c.configuration_uuid === device?.applied_configuration_uuid,
          )
          const pending = command && outstandingCommand(command.status)
          const fresh =
            reading?.quality === "good" &&
            !reading.historical &&
            Date.now() - Date.parse(reading.received_at) <
              Math.min(
                30,
                typeof parameter.reporting?.stale_after_seconds === "number"
                  ? parameter.reporting.stale_after_seconds
                  : 30,
              ) *
                1000
          return (
            <div
              key={parameter.uuid + device?.applied_configuration_uuid}
              className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
            >
              <ParameterControl
                parameter={{
                  ...parameter,
                  label: source.label || parameter.label,
                }}
                reported={reading?.value}
                pending={pending ? command.value : undefined}
                disabled={
                  !ready ||
                  !fresh ||
                  controlSpec(parameter).kind === "unsupported"
                }
                onCommit={(value) => send(parameter.uuid, value)}
                onDirty={(value) =>
                  setDirty((current) => ({
                    ...current,
                    [parameter.uuid]: value,
                  }))
                }
              />
              {ready && !fresh && (
                <p role="status" className="text-sm text-warning">
                  Latest state is stale. Control unavailable.
                </p>
              )}
              {pending && command && (
                <p role="status" className="text-sm text-muted-foreground">
                  Applying {formatValue(command.value)}…
                </p>
              )}
              {command &&
                ["failed", "timed_out", "uncertain"].includes(
                  command.status,
                ) && (
                  <p role="alert" className="text-sm text-destructive">
                    {command.status === "timed_out"
                      ? "Update timed out."
                      : command.status === "uncertain"
                        ? "Update could not be confirmed."
                        : "Update failed."}{" "}
                    {command.diagnostic}
                  </p>
                )}
              {command &&
                ["observed", "already_at_target"].includes(command.status) && (
                  <span className="sr-only" role="status" aria-live="polite">
                    {source.label || parameter.label} updated successfully.
                  </span>
                )}
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}
