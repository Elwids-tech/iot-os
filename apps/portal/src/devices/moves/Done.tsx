import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import type { DeviceMove } from "@iot-os/api-client"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Status, StatusMark } from "@iot-os/ui/components/status-mark"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { api } from "../../lib/api"
import { LoadError } from "../../components/forms"
import { devicePath } from "../shared"

/**
 * How the move is going. It waits for the runtime to stop the active devices, with no
 * timeout, then lists what moved and anything that needs attention in the target.
 */
export function Done({ org, move }: { org: string; move: DeviceMove }) {
  const query = useQuery({
    queryKey: ["device-move", org, move.uuid],
    queryFn: () => api.deviceMove(org, move.uuid),
    initialData: move,
    refetchInterval: (state) => (state.state.data?.status === "stopping" ? 2000 : false),
    refetchIntervalInBackground: true,
  })
  const current = query.data
  const target = current.target
  const stopping = current.waiting_for.devices_stopping
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Status value={current.status} domain="device_move" />
          </PanelTitle>
          <PanelDescription>
            {current.status === "stopping" &&
              `Waiting for the runtime to stop ${stopping === 1 ? "1 device" : `${stopping.toLocaleString()} devices`}. You can close this; the move continues.`}
            {current.status === "completed" && (
              <>
                Moved to {target.name} <RelativeTime at={current.cutover_at} />.
              </>
            )}
            {current.status === "failed" && current.failure_reason}
          </PanelDescription>
        </PanelHeader>
        <PanelContent>
          <ul className="flex flex-col divide-y">
            {current.devices.map((device) => (
              <li
                key={device.predecessor_uuid ?? device.successor_uuid ?? device.name}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                {device.successor_uuid && target.uuid ? (
                  <Link className="text-primary underline-offset-4 hover:underline" to={devicePath(target.uuid, device.successor_uuid) + "/overview"}>
                    {device.name}
                  </Link>
                ) : device.predecessor_uuid ? (
                  <Link className="text-primary underline-offset-4 hover:underline" to={devicePath(org, device.predecessor_uuid) + "/overview"}>
                    {device.name}
                  </Link>
                ) : (
                  <span>{device.name}</span>
                )}
                <span className="flex flex-wrap items-center gap-3">
                  {device.successor_state ? (
                    <Status value={device.successor_state} domain="device_move_successor" />
                  ) : (
                    <Status value={device.state} domain="device_move_device" />
                  )}
                </span>
                {device.successor_reason && <p className="w-full text-meta text-muted-foreground">{device.successor_reason}</p>}
              </li>
            ))}
          </ul>
        </PanelContent>
      </Panel>
      {current.needs_attention.length > 0 && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Needs attention in {target.name}</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <ul className="flex flex-col gap-1 text-body">
              {current.needs_attention.map((item) => (
                <li key={item.uuid}>
                  {target.uuid ? (
                    <Link className="text-primary underline-offset-4 hover:underline" to={devicePath(target.uuid, item.uuid) + "/configuration"}>
                      {item.name}
                    </Link>
                  ) : (
                    item.name
                  )}
                  : {item.reason}
                </li>
              ))}
            </ul>
          </PanelContent>
        </Panel>
      )}
      {current.status === "failed" && (
        <StatusMark tone="info">Nothing moved. Devices the move stopped are being resumed here.</StatusMark>
      )}
      <LoadError error={query.error} />
    </div>
  )
}
