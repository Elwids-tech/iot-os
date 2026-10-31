import type { Meta, StoryObj } from "@storybook/react-vite"
import { Badge } from "@iot-os/ui/components/badge"
import {
  ActivityChanges,
  ActivityDay,
  ActivityItem,
  ActivityTimeline,
  groupByDay,
  type ActivityChangeRow,
} from "@iot-os/ui/components/activity-timeline"
import { Panel, PanelContent } from "@iot-os/ui/components/panel"
import { ago, now } from "../fixtures"

const meta: Meta<typeof ActivityTimeline> = { title: "Components/ActivityTimeline", component: ActivityTimeline }
export default meta

type Entry = {
  id: number
  actor: string | null
  sentence: string
  subject?: string
  organization?: string
  at: string
  changes?: ActivityChangeRow[]
}

const entries: Entry[] = [
  {
    id: 6,
    actor: "Ana Perera",
    sentence: "updated device",
    subject: "Pump house meter",
    organization: "Lakeside Farms",
    at: ago(240),
    changes: [
      { label: "Name", from: "Pump meter", to: "Pump house meter" },
      { label: "Tags", from: ["water"], to: ["water", "north"] },
    ],
  },
  {
    id: 5,
    actor: "Ana Perera",
    sentence: "changed the roles of",
    subject: "Kasun Silva",
    organization: "Lakeside Farms",
    at: ago(1800),
    changes: [{ label: "Roles", from: ["Member"], to: ["Moderator"] }],
  },
  {
    id: 4,
    actor: "Nimal Fernando",
    sentence: "updated dashboard",
    subject: "Plant floor",
    organization: "Lakeside Farms",
    at: ago(5400),
    changes: [
      { label: "Name", from: "Operations", to: "Plant floor" },
      { label: "Layouts", from: null, to: null, opaque: true },
    ],
  },
  {
    id: 3,
    actor: "Platform Admin",
    sentence: "updated billing account",
    subject: "Northwind Integrators",
    at: ago(12 * 3600),
    changes: [{ label: "Contact email", from: null, to: "billing@example.com" }],
  },
  {
    id: 2,
    actor: null,
    sentence: "added parameter “voltage” in device profile",
    subject: "Three-phase Energy Meter",
    organization: "Lakeside Farms",
    at: ago(30 * 3600),
  },
  { id: 1, actor: "Ana Perera", sentence: "invited", subject: "new.person@example.com", organization: "Lakeside Farms", at: ago(4 * 86400) },
]

/**
 * What people did, newest first, a heading per day. The sentence reads after the
 * person's name and before the subject's; the meta line names the organization; edits
 * list old → new values, list changes as added and removed items, and opaque changes
 * (layouts, graphs) only as changed. A deleted person shows as "Deleted user".
 */
export const Days: StoryObj = {
  render: () => (
    <Panel className="max-w-3xl">
      <PanelContent>
        <ActivityTimeline>
          {groupByDay(entries, (entry) => entry.at, now).map((day) => (
            <ActivityDay key={day.key} label={day.label}>
              {day.items.map((entry) => (
                <ActivityItem
                  key={entry.id}
                  actor={entry.actor}
                  at={entry.at}
                  now={now}
                  meta={entry.organization ? <Badge variant="outline">{entry.organization}</Badge> : <Badge variant="secondary">Platform</Badge>}
                  changes={entry.changes ? <ActivityChanges changes={entry.changes} /> : undefined}
                >
                  <span className="font-medium">{entry.actor ?? "Deleted user"}</span> {entry.sentence}{" "}
                  {entry.subject && <span className="font-medium">{entry.subject}</span>}
                </ActivityItem>
              ))}
            </ActivityDay>
          ))}
        </ActivityTimeline>
      </PanelContent>
    </Panel>
  ),
}

/** Changes on their own: values, an emptied value, list items and an opaque change. */
export const Changes: StoryObj = {
  render: () => (
    <ActivityChanges
      className="max-w-md"
      changes={[
        { label: "Display name", from: "Viewers", to: "Readers" },
        { label: "Description", from: "Main hall", to: null },
        { label: "Permissions", from: ["Device.view"], to: ["Device.view", "Organization.view", "Dashboard.view"] },
        { label: "Widgets", from: null, to: null, opaque: true },
      ]}
    />
  ),
}
