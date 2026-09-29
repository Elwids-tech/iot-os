import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type {
  DeviceCapabilities,
  DeviceDetail,
  DeviceDirectoryMeta,
} from "@iot-os/api-client"
import { configurationProfile } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@iot-os/ui/components/empty"
import { StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark"
import { formatAge, formatDateTime, formatNumber } from "@iot-os/ui/lib/format"
import { api } from "../lib/api"

const denied: DeviceCapabilities = {
  view: false,
  manage: false,
  connections: false,
  activate: false,
  command: false,
}

/** One status map for devices, sources, connections, readings and commands: [tone, label]. */
const statuses: Record<string, [StatusTone, string]> = {
  stored: ["good", "Stored"],
  decoded: ["muted", "Decoded"],
  suspended: ["warning", "Suspended"],
  storage_retry: ["warning", "Storage retry"],
  handoff_failed: ["critical", "Handoff failed"],
  discarded: ["muted", "Discarded"],
  duplicate: ["muted", "Duplicate"],
  online: ["good", "Online"],
  offline: ["critical", "Offline"],
  unseen: ["muted", "Not seen yet"],
  unknown: ["muted", "Connection unknown"],
  registered: ["muted", "Registered"],
  active: ["good", "Active"],
  deactivated: ["muted", "Deactivated"],
  archived: ["muted", "Archived"],
  idle: ["muted", "Not configured"],
  pending: ["warning", "Pending"],
  applied: ["good", "Applied"],
  failed: ["critical", "Failed"],
  inactive: ["muted", "Inactive"],
  good: ["good", "Good"],
  stale: ["warning", "Stale"],
  invalid: ["critical", "Invalid"],
  approved: ["good", "Approved"],
  rejected: ["muted", "Ignored"],
  ready: ["good", "Ready"],
  provisioning: ["muted", "Not provisioned"],
  succeeded: ["good", "Succeeded"],
  prepared: ["commanded", "Prepared"],
  sent: ["commanded", "Sent"],
  observed: ["good", "Target state observed"],
  already_at_target: ["good", "Already at target"],
  timed_out: ["critical", "Timed out"],
  uncertain: ["critical", "Uncertain"],
  cancelled: ["muted", "Cancelled"],
}
export function deviceStatus(value: string): [StatusTone, string] {
  const normalized = value.trim().toLowerCase()
  return (
    statuses[normalized] ?? [
      "muted",
      normalized.charAt(0).toUpperCase() + normalized.slice(1).replaceAll("_", " "),
    ]
  )
}
export function DeviceStatus({ value }: { value: string }) {
  const [tone, label] = deviceStatus(value)
  return <StatusMark tone={tone}>{label}</StatusMark>
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

/** Relative age with the absolute time on hover; "Never" when missing. */
export function Age({
  value,
  never = "Never",
}: {
  value: string | null | undefined
  never?: string
}) {
  if (!value) return <span className="text-muted-foreground">{never}</span>
  return (
    <time dateTime={value} title={formatDateTime(value)} className="tabular-nums">
      {formatAge(value)} ago
    </time>
  )
}

export function DeviceEmpty({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <Empty className="border-0 p-6 md:p-8">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}

/** A titled region on a page; `meta` sits after the title and `actions` on the right. */
export function Section({
  title,
  meta,
  actions,
  children,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="skin-label text-sm font-semibold">{title}</h2>
        {meta && <span className="text-sm text-muted-foreground">{meta}</span>}
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
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
export const metricCount = (count: number) =>
  count === 1 ? "1 metric" : `${count} metrics`
export const devicePath = (org: string, device = "") =>
  `/organizations/${encodeURIComponent(org)}/devices${device ? "/" + encodeURIComponent(device) : ""}`
export const profilePath = (org: string, profile: string) =>
  `/organizations/${encodeURIComponent(org)}/device-profiles/${encodeURIComponent(profile)}`
export const gatewayPath = (org: string, gateway?: string) =>
  `/organizations/${encodeURIComponent(org)}/gateways${gateway ? "?gateway=" + encodeURIComponent(gateway) : ""}`
export const discoveryPath = (org: string, gateway?: string) =>
  `/organizations/${encodeURIComponent(org)}/discovery${gateway ? "?gateway=" + encodeURIComponent(gateway) : ""}`

/** Profile of the applied (else last working) configuration; list items carry it as `profile`. */
export function deviceProfile(device: DeviceDetail) {
  if (device.profile) return device.profile
  const id =
    device.applied_configuration_uuid ?? device.last_applied_configuration_uuid
  const configuration = device.configurations?.find((c) => c.uuid === id)
  if (!configuration) return null
  const profile = configurationProfile(configuration).profile
  return {
    uuid: configuration.profile_uuid ?? profile.uuid,
    name: configuration.profile_name ?? profile.name,
    revision: configuration.profile_revision ?? profile.revision,
  }
}
/** Profile display precision per parameter uuid, from the applied (else last working) configuration. */
export function parameterPrecisions(device: DeviceDetail) {
  const id =
    device.applied_configuration_uuid ?? device.last_applied_configuration_uuid
  const configuration = device.configurations?.find((c) => c.uuid === id)
  return new Map(
    (configuration ? configurationProfile(configuration).parameters : []).map(
      (p) => [
        p.uuid,
        typeof p.display?.precision === "number" ? p.display.precision : undefined,
      ],
    ),
  )
}
export function formatReading(value: unknown, precision?: number) {
  return typeof value === "number"
    ? formatNumber(value, precision)
    : formatValue(value)
}
export const configurationRevision = (device: DeviceDetail, uuid: string | null) =>
  uuid ? device.configurations?.find((c) => c.uuid === uuid)?.revision : undefined

export function DevicePages({
  meta,
  onPage,
  label = "Results",
}: {
  meta?: DeviceDirectoryMeta
  onPage: (page: number) => void
  label?: string
}) {
  if (!meta || meta.last_page < 2) return null
  return (
    <nav
      aria-label={label + " pages"}
      className="mt-3 flex items-center justify-end gap-2"
    >
      <span className="mr-2 text-sm text-muted-foreground">
        Page {meta.current_page} of {meta.last_page}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={meta.current_page === 1}
        onClick={() => onPage(meta.current_page - 1)}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={meta.current_page === meta.last_page}
        onClick={() => onPage(meta.current_page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
