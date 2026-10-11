import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlusIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { DataTable } from "@iot-os/ui/components/data-table"
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
