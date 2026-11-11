import { useQuery } from "@tanstack/react-query"
import type { DeviceMoveDeviceInput, DeviceMoveReportsThrough, DeviceMoveReview } from "@iot-os/api-client"
import { SelectField, TextField } from "@iot-os/ui/components/form-fields"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { api } from "../../lib/api"
import { RequestError, fieldError } from "../../components/forms"
import type { MoveSelection } from "./MoveDialog"
import type { MoveTarget } from "./WhereTo"

const NO_SITE = "__none"

/**
 * What the move does, as the review says: each device with its name, code and site in
 * the target, how it reports, what blocks it; what stays, what ends and which profile
 * versions are copied. Edits re-review; nothing changes until Move.
 */
export function WhatComesAlong({
  source,
  target,
  devices,
  review,
  loading,
  error,
  overrides,
  onOverride,
}: {
  source: string
  target: MoveTarget
  devices: MoveSelection[]
  review: DeviceMoveReview | undefined
  loading: boolean
  error: unknown
  overrides: Record<string, DeviceMoveDeviceInput>
  onOverride: (uuid: string, values: Omit<DeviceMoveDeviceInput, "uuid">) => void
}) {
  const sites = useQuery({ queryKey: ["sites", target.uuid], queryFn: () => api.sites(target.uuid) })
  const siteOptions = [
    { value: NO_SITE, label: "No site" },
    ...(sites.data?.data ?? []).map((site) => ({ value: site.uuid, label: site.name })),
  ]
  if (!review) {
    return (
      <div className="flex flex-col gap-3" aria-busy={loading}>
        <RequestError error={error} />
        {!error && <Skeleton className="h-40 w-full" />}
      </div>
    )
  }
  const lifecycles = new Map(devices.map((device) => [device.uuid, device.lifecycle]))
  const inactive = review.devices.filter((device) => lifecycles.get(device.uuid) === "active" && !device.arrives_active)
  const blocked = review.devices.filter((device) => device.blockers.length > 0).length
  const staying = review.summary.filter((sentence) => /dashboard|automation/.test(sentence))
  const ends = review.ends
  return (
    <div className="flex flex-col gap-3" aria-busy={loading}>
      <RequestError error={error} />
      <Panel>
        <PanelHeader>
          <PanelTitle>Devices</PanelTitle>
          <PanelDescription>
            {blocked
              ? `${blocked.toLocaleString()} of ${review.devices.length.toLocaleString()} can’t move yet.`
              : `They continue in ${target.name} with these names and codes.`}
          </PanelDescription>
        </PanelHeader>
        <PanelContent>
          <ul className="flex flex-col divide-y">
            {review.devices.map((device, index) => {
              const override = overrides[device.uuid] ?? { uuid: device.uuid }
              return (
                <li key={device.uuid} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" aria-label={device.name}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium">{device.name}</span>
                    <span className="text-meta text-muted-foreground">{reportsThrough(device.reports_through)}</span>
                  </div>
                  {device.blockers.map((blocker) => (
                    <StatusMark key={blocker} tone="critical">
                      {blocker}
                    </StatusMark>
                  ))}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField
                      label="Name in the target"
                      value={override.name ?? device.successor.name}
                      maxLength={255}
                      onChange={(event) => onOverride(device.uuid, { name: event.target.value })}
                      error={fieldError(error, `devices.${index}.name`)}
                    />
                    <TextField
                      label="Device code"
                      value={override.code ?? device.successor.code}
                      maxLength={128}
                      onChange={(event) => onOverride(device.uuid, { code: event.target.value })}
                      error={fieldError(error, `devices.${index}.code`)}
                    />
                    <SelectField
                      label="Site"
                      value={(override.site_uuid ?? device.successor.site_uuid) || NO_SITE}
                      options={siteOptions}
                      onChange={(site) => onOverride(device.uuid, { site_uuid: site === NO_SITE ? null : site })}
                      error={fieldError(error, `devices.${index}.site_uuid`)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </PanelContent>
      </Panel>
      {inactive.length > 0 && (
        <StatusMark tone="warning">
          {inactive.length === 1 ? "1 active device arrives" : `${inactive.length.toLocaleString()} active devices arrive`} inactive:
          you can’t activate devices in {target.name}. A member who can will activate {inactive.length === 1 ? "it" : "them"} there.
        </StatusMark>
      )}
      <Panel>
        <PanelHeader>
          <PanelTitle>Stays in {source}</PanelTitle>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-1 text-body">
          {staying.length ? staying.map((sentence) => <p key={sentence}>{sentence}</p>) : <p>No dashboard or automation uses these devices.</p>}
          <p className="text-muted-foreground">
            Dashboards and automations keep showing the archived devices and their history up to the move.
          </p>
          {review.pipe_owner_sees_raw_messages && (
            <p className="text-muted-foreground">
              Adapters and gateways stay with their owner, who keeps seeing the raw messages of these devices’ sources but
              nothing of the devices in {target.name}.
            </p>
          )}
        </PanelContent>
      </Panel>
      {(ends.alerts > 0 || ends.geofence_assignments > 0 || ends.application_grants.length > 0) && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Ends with the move</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <ul className="flex flex-col gap-1 text-body">
              {ends.alerts > 0 && <li>{ends.alerts === 1 ? "1 open alert" : `${ends.alerts.toLocaleString()} open alerts`} end.</li>}
              {ends.geofence_assignments > 0 && (
                <li>
                  {ends.geofence_assignments === 1 ? "1 geofence assignment" : `${ends.geofence_assignments.toLocaleString()} geofence assignments`} end.
                </li>
              )}
              {ends.application_grants.map((grant) => (
                <li key={grant.name}>
                  {grant.name} keeps reading {grant.devices === 1 ? "the archived device" : `${grant.devices.toLocaleString()} archived devices`} and won’t see
                  the new {grant.devices === 1 ? "one" : "ones"}.
                </li>
              ))}
            </ul>
          </PanelContent>
        </Panel>
      )}
      {review.profile_copies.length > 0 && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Profiles copied to {target.name}</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <ul className="flex flex-col gap-1 text-body">
              {review.profile_copies.map((copy) => (
                <li key={`${copy.profile}-${copy.revision}`}>
                  {copy.profile} · version {copy.revision} as <span className="font-mono text-code">{copy.code}</span>
                  {copy.reused && <span className="text-muted-foreground"> (already copied)</span>}
                </li>
              ))}
            </ul>
          </PanelContent>
        </Panel>
      )}
    </div>
  )
}

/** How a device reports, naming the pipe and its owner; never the gateway behind an adapter. */
export function reportsThrough(through: DeviceMoveReportsThrough | null): string {
  if (!through) return "No source yet"
  if (through.kind === "direct") return "Its own gateway moves with it"
  return `${through.kind === "adapter" ? "Adapter" : "Gateway"} ${through.name} stays with ${through.owner_organization_name}`
}
