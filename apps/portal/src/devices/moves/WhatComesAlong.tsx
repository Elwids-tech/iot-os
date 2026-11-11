import { useQuery } from "@tanstack/react-query"
import type {
  DeviceMoveDeviceInput,
  DeviceMoveItemAction,
  DeviceMoveReportsThrough,
  DeviceMoveReview,
  DeviceMoveReviewItem,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
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
 * the target, how it reports, what blocks it; each dashboard and automation that uses
 * them with its choice; what ends and which profile versions are copied. Edits re-review;
 * nothing changes until Move.
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
  onChoose,
  onAdd,
}: {
  source: string
  target: MoveTarget
  devices: MoveSelection[]
  review: DeviceMoveReview | undefined
  loading: boolean
  error: unknown
  overrides: Record<string, DeviceMoveDeviceInput>
  onOverride: (uuid: string, values: Omit<DeviceMoveDeviceInput, "uuid">) => void
  onChoose: (item: DeviceMoveReviewItem, action: DeviceMoveItemAction) => void
  /** Adds an automation's or dashboard's other devices to the move (FR-031). */
  onAdd: (uuids: string[]) => void
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
          <PanelTitle>Dashboards and automations</PanelTitle>
          <PanelDescription>
            {review.items.length
              ? "Each one that uses these devices, with a choice made for it. Accepting them is enough."
              : "No dashboard or automation uses these devices."}
          </PanelDescription>
        </PanelHeader>
        {review.items.length > 0 && (
          <PanelContent>
            <ul className="flex flex-col divide-y">
              {review.items.map((item) => (
                <CarriedItem
                  key={`${item.kind}:${item.uuid}`}
                  item={item}
                  source={source}
                  target={target.name}
                  disabled={loading}
                  onChoose={(action) => onChoose(item, action)}
                  onAdd={onAdd}
                />
              ))}
            </ul>
          </PanelContent>
        )}
        {review.pipe_owner_sees_raw_messages && (
          <PanelContent className="text-body text-muted-foreground">
            Adapters and gateways stay with their owner, who keeps seeing the raw messages of these devices’ sources but
            nothing of the devices in {target.name}.
          </PanelContent>
        )}
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

/** The words for each choice; keeping a dashboard that also uses other devices means not copying it. */
export function actionLabel(item: Pick<DeviceMoveReviewItem, "kind" | "uses_only_moving">, action: DeviceMoveItemAction, source: string, target: string): string {
  if (action === "move") return `Move to ${target}`
  if (action === "copy") return `Copy the moving devices’ panels to ${target}`
  if (action === "archive") return `Archive in ${source}`
  return item.kind === "dashboard" && !item.uses_only_moving ? "Don’t copy" : `Keep in ${source}`
}

const OMITTED: Array<[keyof DeviceMoveReviewItem["omitted"], string]> = [
  ["panels", "Left out"],
  ["shares", "No longer shared with"],
  ["recipients", "No longer alerted"],
  ["references", "Loses"],
]

/** One dashboard or automation: whether it uses only moving devices, its choice, and what that leaves out. */
function CarriedItem({
  item,
  source,
  target,
  disabled,
  onChoose,
  onAdd,
}: {
  item: DeviceMoveReviewItem
  source: string
  target: string
  disabled: boolean
  onChoose: (action: DeviceMoveItemAction) => void
  onAdd: (uuids: string[]) => void
}) {
  const others = item.other_devices
  const kind = item.kind === "dashboard" ? "Dashboard" : "Automation"
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" aria-label={`${kind} ${item.name}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{item.name}</span>
        <span className="text-meta text-muted-foreground">
          {kind}
          {item.running && " · on"} ·{" "}
          {others ? `also uses ${others.count === 1 ? "1 device" : `${others.count.toLocaleString()} devices`} that ${others.count === 1 ? "stays" : "stay"}` : "uses only these devices"}
        </span>
      </div>
      <SelectField
        label={`What happens to ${item.name}`}
        labelHidden
        value={item.action}
        disabled={disabled || item.actions.length < 2}
        options={item.actions.map((action) => ({ value: action, label: actionLabel(item, action, source, target) }))}
        onChange={(action) => onChoose(action as DeviceMoveItemAction)}
      />
      {item.outcome && <p className="text-meta text-muted-foreground">{item.outcome}</p>}
      {OMITTED.filter(([key]) => item.omitted[key].length > 0).map(([key, label]) => (
        <p key={key} className="text-meta text-muted-foreground">
          {label}: {item.omitted[key].join(", ")}
        </p>
      ))}
      {others?.can_add && (
        <div>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAdd(others.device_uuids)}>
            Add {others.count === 1 ? "1 device" : `${others.count.toLocaleString()} devices`} to this move
          </Button>
        </div>
      )}
    </li>
  )
}

/** How a device reports, naming the pipe and its owner; never the gateway behind an adapter. */
export function reportsThrough(through: DeviceMoveReportsThrough | null): string {
  if (!through) return "No source yet"
  if (through.kind === "direct") return "Its own gateway moves with it"
  return `${through.kind === "adapter" ? "Adapter" : "Gateway"} ${through.name} stays with ${through.owner_organization_name}`
}
