import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { PageTabs } from "@iot-os/ui/components/page-tabs"
import { Pager } from "@iot-os/ui/components/pager"
import { Panel } from "@iot-os/ui/components/panel"
import { ViewsRail } from "@iot-os/ui/components/views-rail"

const meta: Meta = { title: "Components/Navigation" }
export default meta

function PagerDemo() {
  const [page, setPage] = useState(2)
  return <Pager label="Device pages" page={page} pageCount={5} onPageChange={setPage} />
}

/** The one pager. DataTable uses it in its footer; it hides itself when there is a single page. */
export const Pages: StoryObj = { render: () => <PagerDemo /> }

/** Section navigation beside a page, as in Settings. A scrolling strip on phones. Collections use DataTable views instead. */
export const Sections: StoryObj = {
  render: () => (
    <div className="grid max-w-4xl gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
      <ViewsRail
        label="Settings sections"
        items={[
          { key: "general", label: "General", to: "/settings/general", current: true },
          { key: "members", label: "Members", to: "/settings/members", count: 12 },
          { key: "roles", label: "Roles", to: "/settings/roles", count: 4 },
          { key: "notifications", label: "Notifications", to: "/settings/notifications" },
          { key: "email", label: "Email preferences", to: "/settings/email" },
        ]}
      />
      <Panel className="p-4 text-body text-muted-foreground">The section sits here.</Panel>
    </div>
  ),
}

/** Tabs that are separate pages, each with its own URL, such as Sites and Geofences under Locations. */
export const Tabs: StoryObj = {
  render: () => (
    <div className="max-w-xl border-b">
      <PageTabs
        label="Locations"
        items={[
          { to: "/", label: "Sites", end: true },
          { to: "/geofences", label: "Geofences" },
        ]}
      />
    </div>
  ),
}
