import { useQueries, type UseQueryResult } from "@tanstack/react-query"
import type { ResourceNames, Workflow } from "@iot-os/workflow-editor"
import { api } from "../lib/api"
import type { ControlResource } from "./device-state"

type Page = { data: ControlResource[] }

/** Device and parameter names by UUID, from one resources response per device. */
export function resourceNames(devices: (ControlResource | undefined)[]): ResourceNames {
  const names: ResourceNames = {}
  for (const device of devices) {
    if (!device) continue
    names[device.device_uuid] = device.name
    for (const p of device.parameters) names[p.uuid] = p.label || p.key
  }
  return names
}

const combine = (results: UseQueryResult<Page>[]) => resourceNames(results.map((r) => r.data?.data[0]))

/** Names for the node summaries on the canvas: one request per bound device, shared across nodes. */
export function useResourceNames(org: string, graph: Workflow): ResourceNames {
  const devices = [...new Set(graph.bindings.map((b) => b.device_uuid))].sort()
  return useQueries({
    queries: devices.map((id) => ({
      queryKey: ["automation-device-names", org, id],
      queryFn: () => api.automation<Page>(org, `/dag/resources?device_uuid=${encodeURIComponent(id)}`),
      staleTime: 5 * 60_000,
    })),
    combine,
  })
}
