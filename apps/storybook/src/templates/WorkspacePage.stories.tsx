import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Redo2Icon, SparklesIcon, Undo2Icon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { DraftBar } from "@iot-os/ui/components/draft-bar"
import { InlineName } from "@iot-os/ui/components/inline-name"
import { Panel } from "@iot-os/ui/components/panel"
import { SidebarProvider } from "@iot-os/ui/components/sidebar"
import { WorkspacePage } from "@iot-os/ui/templates/workspace-page"

const meta: Meta = { title: "Templates/Workspace", parameters: { layout: "fullscreen" } }
export default meta

function Editor() {
  const [name, setName] = useState("GPS enters boundary → Waveshare alarm")
  return (
    <SidebarProvider className="-m-6 block min-h-svh">
      <WorkspacePage
        title={name}
        name={<InlineName value={name} onChange={(event) => setName(event.target.value)} />}
        back={{ to: "/automation", label: "Automations" }}
        actions={
          <>
            <Button size="sm" variant="outline">Save</Button>
            <Button size="sm">Activate</Button>
          </>
        }
        tools={
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Undo"><Undo2Icon /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Redo"><Redo2Icon /></Button>
            <Button variant="outline" size="sm"><SparklesIcon data-icon="inline-start" />AI assistant</Button>
          </>
        }
        draft={<DraftBar tone="good" status="Active" revision="Draft 11" dirty />}
      >
        <div className="grid min-h-[28rem] gap-(--panel-gap) lg:grid-cols-[14rem_minmax(0,1fr)_18rem]">
          <Panel className="p-4 text-body text-muted-foreground">Node palette</Panel>
          <Panel className="bg-[radial-gradient(circle,var(--border)_1px,transparent_1.2px)] bg-size-[16px_16px] p-4 text-body text-muted-foreground">Canvas</Panel>
          <Panel className="p-4 text-body text-muted-foreground">Inspector</Panel>
        </div>
      </WorkspacePage>
    </SidebarProvider>
  )
}

/** An editor: name in place, tools and the DraftBar under it, full-width body for the canvas. */
export const Automation: StoryObj = { render: () => <Editor /> }

/** The DraftBar on its own: live state, revision, unsaved changes. */
export const Draft: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <DraftBar tone="good" status="Live: version 3" revision="Draft 7" />
      <DraftBar tone="good" status="Active" revision="Draft 11" dirty />
      <DraftBar tone="info" status="Not published yet" revision="Draft 1" />
    </div>
  ),
}
