import { useMemo } from "react"
import type { LocationMapDevice } from "@iot-os/api-client"
import { LocationMap } from "../geospatial/LocationMap"
import { insideRing } from "./simulation"

type Point = { latitude: number; longitude: number }

/** Click-to-pick map for a simulated GPS fix, drawn over the geofence boundary. */
export default function LocationPicker({ polygon, point, onPick }: { polygon: number[][][] | null; point?: Point; onPick: (point: Point) => void }) {
  const devices = useMemo<LocationMapDevice[]>(() => point ? [{
    device_uuid: "simulated-fix", device_name: "Simulated fix", binding_uuid: "simulated-fix",
    latest: { event_id: "simulated-fix", status: "valid", reason: "", observed_at: null, received_at: null, historical: false, live_eligible: true, point: { ...point, accuracy_metres: null } },
    condition: polygon ? (insideRing(point, polygon[0]) ? "inside" : "outside") : "unknown",
    active: false, wandering: false, active_alert: null, assignment_status: null, deployment_status: null,
    trail: { segments: [], sampled: false },
  }] : [], [point?.latitude, point?.longitude, polygon])
  return <div className="h-56"><LocationMap devices={devices} polygon={polygon} showLabels={false} onPick={onPick} /></div>
}
