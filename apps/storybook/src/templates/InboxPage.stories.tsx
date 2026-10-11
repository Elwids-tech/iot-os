import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@iot-os/ui/components/button"
import { PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SidebarProvider } from "@iot-os/ui/components/sidebar"
import { Status } from "@iot-os/ui/components/status-mark"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { InboxItem, InboxList, InboxPage } from "@iot-os/ui/templates/inbox-page"
import { ago, now } from "../fixtures"

const meta: Meta = { title: "Templates/Inbox", parameters: { layout: "fullscreen" } }
export default meta

const alerts = [
  { id: "a1", title: "Boiler temperature high", device: "Boiler room sensor 1", tone: "critical", state: "open", at: ago(240) },
  { id: "a2", title: "Water flow stopped", device: "Workshop water meter 1", tone: "warning", state: "acknowledged", at: ago(3600) },
  { id: "a3", title: "Tracker left boundary", device: "GPS Demo Tracker 1", tone: "warning", state: "open", at: ago(7200) },
  { id: "a4", title: "Cold store door open", device: "Cold store probe 1", tone: "muted", state: "resolved", at: ago(86400) },
] as const

/** A queue you work through: toolbar on the canvas, the queue on the left, the selected item on the right. */
export const Alerts: StoryObj = {
  render: () => (
    <SidebarProvider className="-m-6 block min-h-svh">
      <InboxPage
        title="Alerts"
        wide
        toolbar={
          <ToggleGroup type="single" size="sm" variant="outline" spacing={0} aria-label="Condition" defaultValue="open">
            <ToggleGroupItem value="open">Open</ToggleGroupItem>
            <ToggleGroupItem value="acknowledged">Acknowledged</ToggleGroupItem>
            <ToggleGroupItem value="resolved">Resolved</ToggleGroupItem>
          </ToggleGroup>
        }
        list={
          <InboxList label="Alerts">
            {alerts.map((alert, index) => (
              <InboxItem
                key={alert.id}
                to={`/alerts/${alert.id}`}
                current={index === 0}
                tone={alert.tone}
                title={alert.title}
                mark={<Status value={alert.state} />}
                meta={
                  <>
                    {alert.device} · <RelativeTime at={alert.at} now={now} bare />
                  </>
                }
              />
            ))}
          </InboxList>
        }
        detail={
          <>
            <PanelHeader>
              <PanelTitle>Boiler temperature high</PanelTitle>
              <PanelDescription>Boiler room sensor 1 · temperature above 85 °C for 5 minutes</PanelDescription>
            </PanelHeader>
            <PanelContent className="flex flex-col gap-4">
              <Status value="open" />
              <div className="flex gap-2">
                <Button size="sm">Acknowledge</Button>
                <Button size="sm" variant="outline">Resolve</Button>
              </div>
            </PanelContent>
          </>
        }
      />
    </SidebarProvider>
  ),
}
