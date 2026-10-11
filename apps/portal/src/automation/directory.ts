import { statusOf, type Status } from "@iot-os/ui/lib/status"

/** Fields added by `GET …/workflows/dag` for the automation directory. */
export type DirectorySummary = {
  deployment_status: string
  updated_at?: string | null
  triggers?: { node_id: string; device_uuid: string; device_name: string | null; parameter: string }[]
  last_action_at?: string | null
  last_deployment?: { target: string; status: string; at: string | null; draft_revision: number } | null
  last_issue?: { source: "deployment" | "action"; message: string; at: string | null } | null
}

/** "Tracker 7: latitude, longitude · Pump: pressure" — the device readings that start evaluation. */
export function triggerSummary(triggers: DirectorySummary["triggers"] = []): string {
  const devices = new Map<string, { name: string; parameters: string[] }>()
  for (const t of triggers) {
    const device = devices.get(t.device_uuid) ?? { name: t.device_name ?? "Unavailable device", parameters: [] }
    if (!device.parameters.includes(t.parameter)) device.parameters.push(t.parameter)
    devices.set(t.device_uuid, device)
  }
  return [...devices.values()].map((d) => `${d.name}: ${d.parameters.join(", ")}`).join(" · ")
}

const deploymentLabel = (d: NonNullable<DirectorySummary["last_deployment"]>) => {
  const verb = d.target === "active" ? "Activation" : "Disable"
  return d.status === "failed" ? `${verb} failed` : d.status === "pending" ? `${verb} requested` : d.target === "active" ? `Activated revision ${d.draft_revision}` : "Disabled"
}

/** The most recent of an action request, a deployment change or a draft edit. */
export function lastActivity(w: DirectorySummary): { label: string; at: string } | undefined {
  const candidates = [
    w.last_action_at && { label: "Action requested", at: w.last_action_at },
    w.last_deployment?.at && { label: deploymentLabel(w.last_deployment), at: w.last_deployment.at },
    w.updated_at && { label: "Draft edited", at: w.updated_at },
  ].filter((c): c is { label: string; at: string } => Boolean(c))
  return candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
}

export function deploymentState(status: string): Status {
  return statusOf(status, "automation")
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]]
export function relativeTime(at: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(at) - now) / 1000)
  if (Math.abs(seconds) < 60) return "just now"
  if (Math.abs(seconds) > 30 * 86400) return new Date(at).toLocaleDateString()
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size)!
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(seconds / size), unit)
}
