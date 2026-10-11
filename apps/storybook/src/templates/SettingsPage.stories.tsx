import type { Meta, StoryObj } from "@storybook/react-vite"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SidebarProvider } from "@iot-os/ui/components/sidebar"
import { AppearanceSettings } from "@iot-os/ui/components/theme-picker"
import { SettingsPage } from "@iot-os/ui/templates/settings-page"

const meta: Meta = { title: "Templates/Settings", parameters: { layout: "fullscreen" } }
export default meta

/** Section navigation on the left, the section on the right. Form sections keep to max-w-form. */
export const General: StoryObj = {
  render: () => (
    <SidebarProvider className="-m-6 block min-h-svh">
      <SettingsPage
        sections={[
          { key: "general", label: "General", to: "/settings/general", current: true },
          { key: "members", label: "Members", to: "/settings/members" },
          { key: "roles", label: "Roles", to: "/settings/roles" },
        ]}
      >
        <Panel className="max-w-form">
          <PanelHeader>
            <PanelTitle>Appearance</PanelTitle>
            <PanelDescription>Applies to this browser only.</PanelDescription>
          </PanelHeader>
          <PanelContent>
            <AppearanceSettings />
          </PanelContent>
        </Panel>
      </SettingsPage>
    </SidebarProvider>
  ),
}
