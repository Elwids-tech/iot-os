import type { Meta, StoryObj } from "@storybook/react-vite"
import { MapPinIcon, PlusIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Freshness } from "@iot-os/ui/components/freshness"
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { Status } from "@iot-os/ui/components/status-mark"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"

const meta: Meta<typeof Panel> = { title: "Components/Panel", component: Panel }
export default meta

const now = Date.parse("2026-10-10T12:00:00Z")
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

/** Title, description and actions in the header; padded content below. */
export const Default: StoryObj = {
  render: () => (
    <Panel className="max-w-md">
      <PanelHeader>
        <PanelTitle>Properties</PanelTitle>
        <PanelActions>
          <Button variant="ghost" size="sm">Edit</Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-body">
          <dt className="text-muted-foreground">Profile</dt>
          <dd>RGB Light (simulator) · rev 2</dd>
          <dt className="text-muted-foreground">Gateway</dt>
          <dd>RGB simulator gateway</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-mono text-code">rgb-light</dd>
        </dl>
      </PanelContent>
    </Panel>
  ),
}

const devices = [
  { name: "Bench environmental sensor ENV-0042", code: "device-553e…b866", status: "online", seen: ago(10 * 3600), expected: 300 },
  { name: "GPS Demo Tracker", code: "gps-demo-tracker", status: "online", seen: ago(6 * 86400), expected: 60 },
  { name: "Conversion QA meter", code: "conversion-qa-meter", status: "deactivated", seen: ago(32 * 86400), expected: null },
  { name: "Water meter manual test", code: "device-ef7b…7632", status: "online", seen: ago(1), expected: 60 },
  { name: "New Device", code: "31984723020", status: "registered", seen: null, expected: null },
]

/** Tables run edge to edge with `flush`; counts and paging sit in the footer. */
export const WithTable: StoryObj = {
  render: () => (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle>Devices</PanelTitle>
        <PanelDescription>5 devices</PanelDescription>
        <PanelActions>
          <Button size="sm"><PlusIcon />Add device</Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last reading</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((d) => (
              <TableRow key={d.code}>
                <TableCell>
                  <span className="block font-medium">{d.name}</span>
                  <span className="font-mono text-meta text-muted-foreground">{d.code}</span>
                </TableCell>
                <TableCell><Status value={d.status} /></TableCell>
                <TableCell><Freshness at={d.seen} expectedSeconds={d.expected} now={now} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelContent>
      <PanelFooter>
        <span>Showing 1–5 of 5 devices</span>
      </PanelFooter>
    </Panel>
  ),
}

/** Empty states sit inside the panel that would hold the content. */
export const Empty: StoryObj = {
  render: () => (
    <Panel className="max-w-xl">
      <PanelHeader>
        <PanelTitle>Geofences</PanelTitle>
      </PanelHeader>
      <PanelContent>
        <EmptyState
          inset
          icon={<MapPinIcon />}
          title="No geofences yet"
          description="Draw a boundary to trigger automations when devices enter or leave it."
          action={<Button variant="outline" size="sm">New geofence</Button>}
        />
      </PanelContent>
    </Panel>
  ),
}

/** Skins set the gap: Console spaces panels, Instrument tiles them. */
export const Grid: StoryObj = {
  render: () => (
    <div className="grid max-w-4xl grid-cols-3 gap-(--panel-gap)">
      {["Devices", "Active alerts", "Automations"].map((title, index) => (
        <Panel key={title}>
          <PanelContent>
            <span className="text-meta text-muted-foreground">{title}</span>
            <div className="text-display">{[6, 4, 1][index]}</div>
          </PanelContent>
        </Panel>
      ))}
      <Panel className="col-span-3">
        <PanelHeader><PanelTitle>Needs attention</PanelTitle></PanelHeader>
        <PanelContent className="text-body text-muted-foreground">4 active devices have sent nothing for over a day.</PanelContent>
      </Panel>
    </div>
  ),
}
