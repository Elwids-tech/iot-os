import type { DeviceMoveReview } from "@iot-os/api-client"
import { Panel, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { StatusMark } from "@iot-os/ui/components/status-mark"

/**
 * The move in sentences, from the review the person confirms. Active devices stop
 * first; the move completes once the runtime has stopped them.
 */
export function Confirm({ review, target }: { review: DeviceMoveReview; target: string }) {
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
      <StatusMark tone="info">
        {stopping
          ? "Active devices stop first. The move completes once the runtime has stopped them; readings that arrive in between are not stored."
          : "The move completes as soon as you confirm."}{" "}
        Each device here is archived as moved and keeps its history.
      </StatusMark>
    </div>
  )
}
