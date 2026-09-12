import type { DeviceDetail } from "@iot-os/api-client"
import type { QueryClient } from "@tanstack/react-query"

export function newerDevice(
  current: DeviceDetail | undefined,
  incoming: DeviceDetail,
): DeviceDetail {
  if (!current) return incoming
  if (incoming.deployment_generation < current.deployment_generation)
    return current
  if (
    incoming.deployment_generation === current.deployment_generation &&
    ((incoming.state_revision ?? 0) < (current.state_revision ?? 0) ||
      incoming.draft_revision < current.draft_revision)
  )
    return current
  return incoming
}
export function reconcileDevice(
  cache: QueryClient,
  org: string,
  device: DeviceDetail,
) {
  cache.setQueryData<DeviceDetail>(["device", org, device.uuid], (current) =>
    newerDevice(current, device),
  )
  for (const key of [
    "devices",
    "device-latest",
    "device-commands",
    "discovery-directory",
    "discovery-options",
    "discovery-candidate",
  ]) {
    void cache.invalidateQueries({ queryKey: [key, org] })
  }
}
export const lifecycleStorageKey = (org: string, id: string) =>
  "device-lifecycle:" + org + ":" + id
