import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type {
  Device,
  DeviceCapabilities,
  DeviceDetail,
  DeviceDirectoryMeta,
} from "@iot-os/api-client"
import { configurationProfile } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Pager } from "@iot-os/ui/components/pager"
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { cn } from "@iot-os/ui/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@iot-os/ui/components/tooltip"
import { formatNumber } from "@iot-os/ui/lib/format"
import { api } from "../lib/api"
import { deviceHealth, healthDetails, type Freshness } from "./model"

const denied: DeviceCapabilities = {
  view: false,
  manage: false,
  connections: false,
  activate: false,
  command: false,
}

/**
 * One health state for a device as a status mark; lifecycle, connection,
 * last seen and configuration on hover or focus. Lists pass `recentMs:
 * Infinity` and show freshness in its own column instead of "no recent data".
 */
export function HealthStatus({
  device,
  freshness,
  className,
}: {
  device: Pick<Device, "lifecycle" | "presence" | "deployment_status" | "last_seen_at">
  freshness?: Freshness
  className?: string
}) {
  const { tone, label } = deviceHealth(device, freshness)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StatusMark tone={tone} tabIndex={0} className={cn("rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
          {label}
        </StatusMark>
      </TooltipTrigger>
      <TooltipContent>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          {healthDetails(device).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="opacity-70">{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </TooltipContent>
    </Tooltip>
  )
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

/** Adapter over the kit EmptyState for device-area panels. */
export function DeviceEmpty({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return <EmptyState inset title={title} description={description} action={children} />
}

/** A titled panel on a device page; `meta` sits after the title and `actions` on the right. */
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
    <Panel className={className}>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
        {meta && <PanelDescription className="text-body">{meta}</PanelDescription>}
        {actions && <PanelActions className="flex-wrap">{actions}</PanelActions>}
      </PanelHeader>
      <PanelContent>{children}</PanelContent>
    </Panel>
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
  `/organizations/${encodeURIComponent(org)}/gateways${gateway ? "/" + encodeURIComponent(gateway) : ""}`
export const connectionsPath = (org: string) =>
  `/organizations/${encodeURIComponent(org)}/connections`
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

/** Adapter over the kit Pager for device-area lists that page on the server. */
export function DevicePages({
  meta,
  onPage,
  label = "Results",
}: {
  meta?: DeviceDirectoryMeta
  onPage: (page: number) => void
  label?: string
}) {
  if (!meta) return null
  return (
    <Pager
      className="mt-3 justify-end"
      page={meta.current_page}
      pageCount={meta.last_page}
      label={label + " pages"}
      onPageChange={onPage}
    />
  )
}
