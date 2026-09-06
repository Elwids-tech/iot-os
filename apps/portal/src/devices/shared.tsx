import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type { DeviceCapabilities } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@iot-os/ui/components/empty"
import { api } from "../lib/api"

const denied: DeviceCapabilities = {
  view: false,
  manage: false,
  connections: false,
  activate: false,
  command: false,
}
export function useDeviceOrganization() {
  const { organizationUuid = "" } = useParams()
  const query = useQuery({
    queryKey: ["device-organization", organizationUuid],
    queryFn: () => api.organizationContext(organizationUuid),
  })
  return {
    org: organizationUuid,
    capabilities: query.data?.capabilities?.devices ?? denied,
    query,
  }
}
export function DeviceStatus({ value }: { value: string }) {
  const label: Record<string, string> = {
    observed: "Target state observed",
    already_at_target: "Already at target",
    timed_out: "Timed out",
    unseen: "Not seen yet",
    applied: "Applied",
    pending: "Pending",
    unknown: "Connection unknown",
  }
  const bad = ["failed", "uncertain", "invalid", "timed_out"].includes(value)
  return (
    <Badge
      variant={
        bad
          ? "destructive"
          : ["online", "good", "observed", "active"].includes(value)
            ? "default"
            : "secondary"
      }
    >
      {label[value] ?? value.replaceAll("_", " ")}
    </Badge>
  )
}
export function DeviceEmpty({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
export function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not yet"
}
export function formatValue(value: unknown) {
  return value === null || value === undefined
    ? "—"
    : typeof value === "number"
      ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
}
export const devicePath = (org: string, device = "") =>
  `/organizations/${encodeURIComponent(org)}/devices${device ? "/" + encodeURIComponent(device) : ""}`

export function DevicePages({
  meta,
  onPage,
  label = "Results",
}: {
  meta?: import("@iot-os/api-client").DeviceDirectoryMeta
  onPage: (page: number) => void
  label?: string
}) {
  if (!meta || meta.last_page < 2) return null
  return (
    <nav
      aria-label={label + " pages"}
      className="mt-4 flex items-center justify-between gap-3"
    >
      <Button
        variant="outline"
        disabled={meta.current_page === 1}
        onClick={() => onPage(meta.current_page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm">
        Page {meta.current_page} of {meta.last_page}
      </span>
      <Button
        variant="outline"
        disabled={meta.current_page === meta.last_page}
        onClick={() => onPage(meta.current_page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
