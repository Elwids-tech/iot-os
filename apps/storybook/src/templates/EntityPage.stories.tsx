import type { Meta, StoryObj } from "@storybook/react-vite"
import { CpuIcon, EllipsisIcon, PlusIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Freshness } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SidebarProvider } from "@iot-os/ui/components/sidebar"
import { Status } from "@iot-os/ui/components/status-mark"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { EntityPage, PropertyList } from "@iot-os/ui/templates/entity-page"
import { ago, now } from "../fixtures"

const meta: Meta = { title: "Templates/Entity", parameters: { layout: "fullscreen" } }
export default meta

/** One record: identity and status in the header, at most five tabs, panels with a properties rail. */
export const Device: StoryObj = {
  render: () => (
    <SidebarProvider className="-m-6 block min-h-svh">
      <Tabs defaultValue="overview" className="gap-0">
        <EntityPage
          title="RGB LED · Controls demo"
          icon={<CpuIcon />}
          code="rgb-controls-demo"
          back={{ to: "/devices", label: "Devices" }}
          actions={
            <>
              <Button variant="outline" size="sm">
                <PlusIcon data-icon="inline-start" />
                Add to dashboard
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="Device actions">
                <EllipsisIcon />
              </Button>
            </>
          }
          status={
            <>
              <Status value="active" />
              <Status value="online" />
              <Freshness at={ago(6 * 86400)} expectedSeconds={1800} now={now} />
            </>
          }
          tabs={
            <TabsList variant="line" className="justify-start px-1">
              {["Overview", "Data", "Control", "Configuration", "Connectivity"].map((label) => (
                <TabsTrigger key={label} value={label.toLowerCase()} className="flex-none">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          }
          rail={
            <Panel>
              <PanelHeader>
                <PanelTitle>Properties</PanelTitle>
              </PanelHeader>
              <PanelContent>
                <PropertyList
                  items={[
                    { label: "Profile", value: "RGB Light (simulator) · rev 2" },
                    { label: "Gateway", value: "RGB simulator gateway" },
                    { label: "Source", value: <span className="font-mono text-code">rgb-light</span> },
                    { label: "Site", value: "None · organization time zone" },
                  ]}
                />
              </PanelContent>
            </Panel>
          }
        >
          <TabsContent value="overview">
            <Panel>
              <PanelHeader>
                <PanelTitle>Latest measurements</PanelTitle>
              </PanelHeader>
              <PanelContent className="text-body text-muted-foreground">Readings and charts go here.</PanelContent>
            </Panel>
          </TabsContent>
        </EntityPage>
      </Tabs>
    </SidebarProvider>
  ),
}
