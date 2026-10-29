import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@iot-os/ui/components/button"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Label } from "@iot-os/ui/components/label"
import { NotificationBell, type NotificationBellItem } from "@iot-os/ui/components/notification-bell"
import { Switch } from "@iot-os/ui/components/switch"
import { BellIcon } from "lucide-react"

const meta: Meta<typeof NotificationBell> = { title: "Components/NotificationBell", component: NotificationBell }
export default meta

const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString()
const items: NotificationBellItem[] = [
  { id: "n4", title: "Cold room door open", description: "Freezer 2", status: "activated", domain: "alert", detail: "Still active", time: ago(1), to: "#n4", unread: true },
  { id: "n3", title: "Hot spot above 80 °C", description: "Fire-watch box 01", status: "cleared", domain: "alert", detail: "Cleared now", time: ago(12), to: "#n3", unread: true },
  { id: "n2", title: "Phase voltage band", status: "activated", domain: "alert", detail: "Cleared now", time: ago(95), to: "#n2", unread: false },
  { id: "n1", title: "Battery low", description: "GPS tracker", status: "activated", domain: "alert", detail: "Cleared now", time: ago(60 * 26), to: "#n1", unread: false },
]

/** The header bell as a page shows it: an open list, controlled by the app. */
function Bell(props: Partial<React.ComponentProps<typeof NotificationBell>>) {
  const [open, setOpen] = useState(true)
  const [sound, setSound] = useState(true)
  return (
    <div className="flex min-h-[32rem] justify-end p-4">
      <NotificationBell
        count={items.filter((item) => item.unread).length}
        open={open}
        onOpenChange={setOpen}
        items={items}
        actions={<Button variant="ghost" size="xs">Mark all read</Button>}
        toolbar={
          <div className="flex items-center justify-between gap-2 text-meta">
            <Label htmlFor="story-sound">Sound for new alerts</Label>
            <Switch id="story-sound" size="sm" checked={sound} onCheckedChange={setSound} />
          </div>
        }
        footer={<a href="#alerts" className="text-primary underline-offset-4 hover:underline">All alerts</a>}
        {...props}
      />
    </div>
  )
}

/** Unread items carry a dot and a heavier title; the badge counts them. */
export const Unread: StoryObj = { render: () => <Bell hasOlder /> }

/** Everything read: no badge, and the accessible name drops the count. */
export const Read: StoryObj = { render: () => <Bell count={0} items={items.map((item) => ({ ...item, unread: false }))} /> }

/** Above nine the badge reads 9+, while the accessible name keeps the number. */
export const ManyUnread: StoryObj = { render: () => <Bell count={57} /> }

export const Empty: StoryObj = {
  render: () => (
    <Bell
      count={0}
      items={[]}
      actions={null}
      empty={
        <EmptyState
          inset
          icon={<BellIcon />}
          title="No alert notifications"
          description="Alerts appear here when an automation lists you as a recipient."
          action={<Button variant="outline" size="sm">Choose recipients</Button>}
        />
      }
    />
  ),
}

export const Loading: StoryObj = { render: () => <Bell count={undefined} items={[]} loading /> }

/** A failed list keeps the header working and says so; the badge stays quiet. */
export const Failed: StoryObj = { render: () => <Bell count={undefined} items={[]} error="Notifications could not load. They will retry shortly." /> }

/** Long names truncate on one line; the full text stays in the link's name. */
export const LongNames: StoryObj = {
  render: () => (
    <Bell
      items={[
        { ...items[0], title: "Compressor discharge temperature above the high-limit setpoint for more than ten minutes", description: "Refrigeration plant 3 · Rack B · Compressor 4 discharge line sensor" },
        ...items.slice(1),
      ]}
    />
  ),
}

/** At 375 px the list fits the screen without sideways scrolling. */
export const Phone: StoryObj = {
  render: () => (
    <div className="w-[375px] border">
      <Bell />
    </div>
  ),
}
