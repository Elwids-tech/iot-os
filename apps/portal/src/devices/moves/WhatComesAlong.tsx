import { useQuery } from "@tanstack/react-query"
import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import type {
  DeviceMoveDeviceInput,
  DeviceMoveItemAction,
  DeviceMoveReportsThrough,
  DeviceMoveReview,
  DeviceMoveReviewItem,
} from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { CheckboxField, SelectField, TextField } from "@iot-os/ui/components/form-fields"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../../lib/api"
import { RequestError, fieldError } from "../../components/forms"
import type { MoveSelection } from "./MoveDialog"
import type { MoveTarget } from "./WhereTo"

const NO_SITE = "__none"

/**
 * What the move does, as the review says: each device with its name, code and site in
 * the target, how it reports, what blocks it; each dashboard and automation that uses
 * them with its choice; what ends, which profile versions are copied, and whether the
 * target reads the readings from before the move. A device moved back reconnects to the
 * readings it recorded in the target before, whatever the option. Where automations are
 * turned off in the target, an automation that moves can't be changed or turned on there;
 * a mover who may turn them on can choose to (FR-039). Edits re-review; nothing changes
 * until Move.
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
  includeHistory,
  onIncludeHistory,
  turnOnAutomations,
  onTurnOnAutomations,
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
  includeHistory: boolean
  onIncludeHistory: (include: boolean) => void
  turnOnAutomations: boolean
  onTurnOnAutomations: (turnOn: boolean) => void
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
  const one = review.devices.length === 1
  const returning = review.devices.filter((device) => device.returns).length
  const ends = review.ends
  // Automations that move where automations are off can't be changed or turned on there (FR-039).
  const movingAutomations = review.items.filter((item) => item.kind === "automation" && item.action === "move").length
  const automationsOff = movingAutomations > 0 && !review.automations.enabled
  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={loading}>
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
                    <Alert key={blocker} variant="destructive" role="note">
                      <CircleAlertIcon />
                      <AlertDescription>{blocker}</AlertDescription>
                    </Alert>
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
      {review.pipe_owner_sees_raw_messages && (
        <Alert role="note" className="border-info/40 bg-info/5">
          <InfoIcon className="text-info" />
          <AlertDescription className="text-foreground">
            Adapters and gateways stay with their owner, who keeps seeing the raw messages of these devices’ sources but
            nothing of the devices in {target.name}.
          </AlertDescription>
        </Alert>
      )}
      {inactive.length > 0 && (
        <Alert role="note" className="border-warning/40 bg-warning/5">
          <TriangleAlertIcon className="text-warning" />
          <AlertDescription className="text-foreground">
            {inactive.length === 1 ? "1 active device arrives" : `${inactive.length.toLocaleString()} active devices arrive`} inactive:
            you can’t activate devices in {target.name}. A member who can will activate {inactive.length === 1 ? "it" : "them"} there.
          </AlertDescription>
        </Alert>
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
      </Panel>
      {automationsOff && (
        <Alert role="note" className="border-warning/40 bg-warning/5">
          <TriangleAlertIcon className="text-warning" />
          <AlertTitle>Automations are turned off in {target.name}</AlertTitle>
          <AlertDescription className="text-foreground">
            <p>
              {movingAutomations === 1 ? "The automation that moves" : `The ${movingAutomations.toLocaleString()} automations that move`}{" "}
              can’t be changed or turned on there until automations are turned on.
              {!review.automations.offered &&
                ` A member of ${target.name} who can activate automations turns them on from its Automations page.`}
            </p>
            {review.automations.offered && (
              <CheckboxField
                className="mt-2"
                label={`Turn on automations in ${target.name}`}
                description={`As Enable automation preview on its Automations page: members of ${target.name} can then build automations there, and those who can activate automations can turn them on.`}
                checked={turnOnAutomations}
                disabled={loading}
                onCheckedChange={onTurnOnAutomations}
              />
            )}
          </AlertDescription>
        </Alert>
      )}
      {review.history.offered && (
        <Panel>
          <PanelHeader>
            <PanelTitle>History</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <CheckboxField
              label="Include readings from before the move"
              description={`Members of ${target.name} will see ${one ? "the device’s" : "each device’s"} readings from before the move in ${one ? "its" : "their"} charts, tables, exports, dashboards and the API, marked as recorded in ${source}. The readings stay stored in ${source}, for as long as ${source} keeps readings, and ${source} can stop sharing them at any time.`}
              checked={includeHistory}
              onCheckedChange={onIncludeHistory}
            />
            {returning > 0 && (
              <p className="mt-3 text-meta text-muted-foreground">
                {one
                  ? "This device was"
                  : returning === review.devices.length
                    ? "These devices were"
                    : `${returning.toLocaleString()} of these devices were`}{" "}
                in {target.name} before. {returning === 1 ? "It reconnects to the readings it" : "They reconnect to the readings they"}{" "}
                recorded there, whether or not you include the readings from before this move.
              </p>
            )}
          </PanelContent>
        </Panel>
      )}
      {(ends.alerts > 0 || ends.geofence_assignments > 0 || ends.application_grants.length > 0) && (
        <Alert role="note" className="border-info/40 bg-info/5">
          <InfoIcon className="text-info" />
          <AlertTitle>Ends with the move</AlertTitle>
          <AlertDescription className="text-foreground">
            <ul className="flex flex-col gap-1">
              {ends.alerts > 0 && <li>{ends.alerts === 1 ? "1 open alert ends" : `${ends.alerts.toLocaleString()} open alerts end`}.</li>}
              {ends.geofence_assignments > 0 && (
                <li>
                  {ends.geofence_assignments === 1 ? "1 geofence assignment ends" : `${ends.geofence_assignments.toLocaleString()} geofence assignments end`}.
                </li>
              )}
              {ends.application_grants.map((grant) => (
                <li key={grant.name}>
                  {grant.name} keeps reading {grant.devices === 1 ? "the archived device" : `${grant.devices.toLocaleString()} archived devices`} and won’t see
                  the new {grant.devices === 1 ? "one" : "ones"}.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {review.profile_copies.length > 0 && (
        <Alert role="note" className="border-info/40 bg-info/5">
          <InfoIcon className="text-info" />
          <AlertTitle>Profiles copied to {target.name}</AlertTitle>
          <AlertDescription className="text-foreground">
            <ul className="flex flex-col gap-1">
              {review.profile_copies.map((copy) => (
                <li key={`${copy.profile}-${copy.revision}`}>
                  {copy.profile} · version {copy.revision} as <span className="font-mono text-code">{copy.code}</span>
                  {copy.reused && <span className="text-muted-foreground"> (already copied)</span>}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
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
