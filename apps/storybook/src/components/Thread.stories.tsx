import type { Meta, StoryObj } from "@storybook/react-vite"
import { CircleDotIcon, UserPlusIcon } from "lucide-react"
import { Markdown } from "@iot-os/ui/components/markdown"
import { Status } from "@iot-os/ui/components/status-mark"
import { Thread, ThreadEvent, ThreadFiles, ThreadMessage } from "@iot-os/ui/components/thread"
import { TicketThread, type TicketThreadItem } from "@iot-os/ui/components/ticket-thread"
import { ago } from "../fixtures"

const meta: Meta<typeof Thread> = { title: "Components/Thread", component: Thread }
export default meta

const screenshot =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#2a3442"/><rect x="12" y="14" width="96" height="10" rx="3" fill="#5b6b80"/><rect x="12" y="34" width="136" height="70" rx="6" fill="#3a475a"/></svg>')

/**
 * A support ticket's history: messages as cards and changes as single lines, oldest
 * first. Team replies carry a badge; internal notes are dashed and only shown to the
 * team. Images open full size; other files download.
 */
export const SupportTicket: StoryObj = {
  render: () => (
    <div className="max-w-2xl">
      <Thread>
        <ThreadMessage author="Ana Perera" at={ago(7200)}>
          <Markdown>{"The pump meter shows no readings on **Devices**.\n\n1. Open Devices\n2. Pick *Pump house meter*\n\nExpected the last hour of readings."}</Markdown>
          <ThreadFiles
            files={[
              { id: "1", name: "devices-page.png", mime: "image/png", size: 182_000, href: screenshot },
              { id: "2", name: "meter-export.pdf", mime: "application/pdf", size: 1_400_000, href: "#" },
            ]}
          />
        </ThreadMessage>
        <ThreadEvent icon={<UserPlusIcon />} at={ago(6900)}>
          Ana Perera added <span className="text-foreground">Kasun Silva</span>
        </ThreadEvent>
        <ThreadMessage author="Nimal (support)" badge="Team" at={ago(3600)} internal>
          <Markdown>{"Gateway firmware 2.1 drops the meter's birth certificate. Same as #38."}</Markdown>
        </ThreadMessage>
        <ThreadMessage author="Nimal (support)" badge="Team" at={ago(3500)}>
          <Markdown>{"Thanks, Ana. Which serial number is on the meter?"}</Markdown>
        </ThreadMessage>
        <ThreadEvent icon={<CircleDotIcon />} at={ago(3500)}>
          Nimal (support) changed the status to <Status value="needs_info" domain="ticket" />
        </ThreadEvent>
      </Thread>
    </div>
  ),
}

const person = (id: number, name: string) => ({ id, name })
const item = (fields: Partial<TicketThreadItem> & Pick<TicketThreadItem, "type" | "key" | "created_at">): TicketThreadItem => ({
  actor: null, from_team: false, internal: false, body: null, attachments: [], event: null, from: null, to: null, cause: null, ...fields,
})

/**
 * The support ticket composition shared by the portal and admin: API timeline entries
 * become messages and one-line changes. Status changes caused by a reply say so.
 */
export const TicketHistory: StoryObj = {
  render: () => (
    <div className="max-w-2xl">
      <TicketThread
        fileHref={() => screenshot}
        items={[
          item({ type: "message", key: "m1", created_at: ago(7200), actor: person(4, "Ana Perera"), body: "The pump meter page is empty since Monday.", attachments: [{ uuid: "a1", name: "pump.png", mime: "image/png", size: 92_000 }] }),
          item({ type: "event", key: "e1", created_at: ago(7200), actor: person(4, "Ana Perera"), event: "created" }),
          item({ type: "event", key: "e2", created_at: ago(5000), actor: person(1, "Nimal"), event: "priority", from: "normal", to: "high", internal: true }),
          item({ type: "message", key: "m2", created_at: ago(4000), actor: person(1, "Nimal"), from_team: true, body: "Which serial number is on the meter?" }),
          item({ type: "event", key: "e3", created_at: ago(4000), actor: person(1, "Nimal"), event: "status", from: "new", to: "needs_info" }),
          item({ type: "message", key: "m3", created_at: ago(600), actor: person(4, "Ana Perera"), body: "Serial **4411**." }),
          item({ type: "event", key: "e4", created_at: ago(600), actor: person(4, "Ana Perera"), event: "status", from: "needs_info", to: "in_review", cause: "reply" }),
          item({ type: "event", key: "e5", created_at: ago(300), actor: person(4, "Ana Perera"), event: "participant_added", to: person(6, "Kasun Silva") }),
        ]}
      />
    </div>
  ),
}
