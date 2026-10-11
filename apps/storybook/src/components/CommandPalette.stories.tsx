import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { BellIcon, CpuIcon, LayoutDashboardIcon, PlusIcon, SettingsIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { CommandPalette } from "@iot-os/ui/components/command-palette"
import { fleet } from "../fixtures"

const meta: Meta = { title: "Components/CommandPalette" }
export default meta

function Palette() {
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState("")
  const go = () => setOpen(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Search <kbd className="ml-2 font-mono text-meta text-muted-foreground">⌘K</kbd>
      </Button>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        search={search}
        onSearchChange={setSearch}
        groups={[
          {
            heading: "Pages",
            items: [
              { id: "devices", label: "Devices", icon: <CpuIcon />, onSelect: go },
              { id: "dashboards", label: "Dashboards", icon: <LayoutDashboardIcon />, onSelect: go },
              { id: "alerts", label: "Alerts", icon: <BellIcon />, onSelect: go },
              { id: "settings", label: "Settings", icon: <SettingsIcon />, onSelect: go },
            ],
          },
          {
            heading: "Devices",
            items: fleet.slice(0, 5).map((device) => ({
              id: device.uuid,
              label: device.name,
              hint: device.code,
              keywords: [device.code],
              icon: <CpuIcon />,
              onSelect: go,
            })),
          },
          { heading: "Actions", items: [{ id: "add-device", label: "Add a device", icon: <PlusIcon />, onSelect: go }] },
        ]}
      />
    </>
  )
}

/** ⌘K from anywhere: pages, records the page fetches as you type, and common actions. */
export const Open: StoryObj = { render: () => <Palette /> }
