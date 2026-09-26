import type { LocationMapDevice } from "@iot-os/api-client"

export const trailColors = ["#2563eb", "#9333ea", "#d97706", "#0891b2", "#db2777", "#475569"]

export function markerColor(device: LocationMapDevice): string {
  if (!device.latest?.live_eligible || device.condition === "unknown") return "#64748b"
  return device.condition === "inside" ? "#16a34a" : "#dc2626"
}
