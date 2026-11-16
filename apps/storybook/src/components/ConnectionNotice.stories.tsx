import type { Meta, StoryObj } from "@storybook/react-vite"
import { ConnectionNotice } from "@iot-os/ui/components/connection-notice"
import { Freshness } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"

const meta: Meta<typeof ConnectionNotice> = { title: "Components/ConnectionNotice", component: ConnectionNotice }
export default meta

const now = Date.parse("2026-11-16T12:00:00Z")
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

/**
 * The offline banner. Apps render it under every page header while the connection is
 * lost; values already on the page keep their own age labels and are never shown as current.
 */
export const UnderAPageHeader: StoryObj = {
  render: () => (
    <div className="max-w-2xl">
      <header className="border-b">
        <div className="flex min-h-14 items-center px-4 md:px-6">
          <h1 className="text-lg font-semibold tracking-tight">Energy meter</h1>
        </div>
        <ConnectionNotice at={ago(95)} now={now} />
      </header>
      <div className="p-4 md:p-6">
        <Panel>
          <PanelHeader>
            <PanelTitle>Latest readings</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <dl className="grid grid-cols-[8rem_1fr_auto] gap-y-2 text-body">
              <dt className="text-muted-foreground">Voltage</dt>
              <dd className="font-mono">231.4 V</dd>
              <dd><Freshness at={ago(120)} expectedSeconds={60} now={now} /></dd>
            </dl>
          </PanelContent>
        </Panel>
      </div>
    </div>
  ),
}

/** Without a last response (the page never reached the API) it says values may be out of date. */
export const NoLastResponse: StoryObj = {
  render: () => <ConnectionNotice className="max-w-2xl" />,
}
