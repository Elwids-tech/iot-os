import type { DeviceMoveReview } from "@iot-os/api-client"
import { CheckboxField } from "@iot-os/ui/components/form-fields"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { StatusMark } from "@iot-os/ui/components/status-mark"

type Archive = DeviceMoveReview["archives"][number]

/**
 * The move in sentences, from the review the person confirms. Anything to be archived is
 * listed on its own and confirmed one by one before **Move** (FR-006). Active devices
 * stop first; the move completes once the runtime has stopped them.
 */
export function Confirm({
  review,
  source,
  target,
  confirmed,
  onConfirm,
}: {
  review: DeviceMoveReview
  source: string
  target: string
  confirmed: Record<string, boolean>
  onConfirm: (item: Archive, checked: boolean) => void
}) {
  const stopping = review.devices.some((device) => device.reports_through !== null)
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeader>
          <PanelTitle>Moving to {target}</PanelTitle>
        </PanelHeader>
        <PanelContent>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body">
            {review.summary.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </PanelContent>
      </Panel>
      {review.archives.length > 0 && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Archived in {source}</PanelTitle>
            <PanelDescription>
              Confirm each one. Archived {review.archives.some((item) => item.kind === "automation") ? "automations are turned off and " : ""}
              items are hidden behind Show archived, and a member with the matching permission can restore them.
            </PanelDescription>
          </PanelHeader>
          <PanelContent className="flex flex-col gap-3">
            {review.archives.map((item) => (
              <CheckboxField
                key={`${item.kind}:${item.uuid}`}
                label={`Archive ${item.kind === "dashboard" ? "dashboard" : "automation"} ${item.name}`}
                checked={Boolean(confirmed[`${item.kind}:${item.uuid}`])}
                onCheckedChange={(checked) => onConfirm(item, checked)}
              />
            ))}
          </PanelContent>
        </Panel>
      )}
      <StatusMark tone="info">
        {stopping
          ? "Active devices stop first. The move completes once the runtime has stopped them; readings that arrive in between are not stored."
          : "The move completes as soon as you confirm."}{" "}
        Each device here is archived as moved and keeps its history.
      </StatusMark>
    </div>
  )
}
