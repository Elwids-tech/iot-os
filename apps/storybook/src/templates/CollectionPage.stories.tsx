import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlusIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { DataTable } from "@iot-os/ui/components/data-table"
import { Field, FieldLabel } from "@iot-os/ui/components/field"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { SidebarProvider } from "@iot-os/ui/components/sidebar"
import { Status } from "@iot-os/ui/components/status-mark"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { fleet } from "../fixtures"

const meta: Meta = { title: "Templates/Collection", parameters: { layout: "fullscreen" } }
export default meta

/** PageHeader carries the phone sidebar trigger, so the story provides a sidebar context. A list of things: title and one primary action, then the table's toolbar on the canvas and its rows in a panel. */
export const Devices: StoryObj = {
  render: () => (
    <SidebarProvider className="-m-6 block min-h-svh">
      <CollectionPage
        title="Devices"
        actions={
          <Button size="sm">
            <PlusIcon data-icon="inline-start" />
            Add device
          </Button>
        }
      >
        <DataTable
          id="story-collection"
          label="Devices"
          noun={["device", "devices"]}
          rows={fleet.slice(0, 12)}
          rowKey={(d) => d.uuid}
          columns={[
            { id: "device", header: "Device", value: (d) => d.name, sortable: true, cell: (d) => <span className="font-medium">{d.name}</span> },
            { id: "status", header: "Status", cell: (d) => <Status value={d.lifecycle === "active" ? d.presence : d.lifecycle} /> },
            { id: "profile", header: "Profile", value: (d) => d.profile, cell: (d) => d.profile ?? "None" },
          ]}
        />
      </CollectionPage>
    </SidebarProvider>
  ),
}

/** Filters outside the table: a row above it from 768 px, behind Filters in a bottom sheet on phones. */
function FilteredDevices() {
  const [presence, setPresence] = useState("all")
  const [mine, setMine] = useState(false)
  const rows = fleet
    .slice(0, 12)
    .filter((d) => presence === "all" || d.presence === presence)
  return (
    <SidebarProvider className="-m-6 block min-h-svh">
      <CollectionPage
        title="Devices"
        actions={
          <Button size="sm">
            <PlusIcon data-icon="inline-start" />
            Add device
          </Button>
        }
        filters={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Presence"
              value={presence}
              onValueChange={(value) => value && setPresence(value)}
            >
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="online">Online</ToggleGroupItem>
              <ToggleGroupItem value="offline">Offline</ToggleGroupItem>
            </ToggleGroup>
            <Field orientation="horizontal" className="w-auto">
              <Checkbox id="story-mine" checked={mine} onCheckedChange={(value) => setMine(value === true)} />
              <FieldLabel htmlFor="story-mine" className="font-normal">Assigned to me</FieldLabel>
            </Field>
          </>
        }
        activeFilterCount={Number(presence !== "all") + Number(mine)}
        onResetFilters={() => {
          setPresence("all")
          setMine(false)
        }}
      >
        <DataTable
          id="story-collection-filtered"
          label="Devices"
          noun={["device", "devices"]}
          rows={rows}
          rowKey={(d) => d.uuid}
          columns={[
            { id: "device", header: "Device", mobile: "title", value: (d) => d.name, cell: (d) => <span className="font-medium">{d.name}</span> },
            { id: "status", header: "Status", mobile: "badge", cell: (d) => <Status value={d.lifecycle === "active" ? d.presence : d.lifecycle} /> },
            { id: "profile", header: "Profile", value: (d) => d.profile, cell: (d) => d.profile ?? "None" },
          ]}
        />
      </CollectionPage>
    </SidebarProvider>
  )
}

export const WithFilters: StoryObj = {
  globals: { viewport: { value: "computer", isRotated: false } },
  render: () => <FilteredDevices />,
}

/** Phones (under 768 px): one Filters button with the active count opens every filter in a bottom sheet; rows are cards. */
export const Phone: StoryObj = {
  globals: { viewport: { value: "phone", isRotated: false } },
  render: () => <FilteredDevices />,
}
