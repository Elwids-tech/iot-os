import type { Meta, StoryObj } from "@storybook/react-vite"
import { Status, StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark"
import { statusVocabulary } from "@iot-os/ui/lib/status"

const meta: Meta = { title: "Foundations/Status vocabulary" }
export default meta

const tones: StatusTone[] = ["good", "warning", "critical", "info", "muted", "commanded"]

/** Six tones. A mark is always a square plus a label, never colour alone. */
export const Tones: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      {tones.map((tone) => (
        <StatusMark key={tone} tone={tone}>
          {tone}
        </StatusMark>
      ))}
    </div>
  ),
}

/** Every shared value from statusOf. Add new values to lib/status, never to a local map. */
export const Vocabulary: StoryObj = {
  render: () => (
    <section className="max-w-4xl overflow-hidden rounded-xl bg-card shadow-panel">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {Object.keys(statusVocabulary).map((value) => (
          <div key={value} className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
            <Status value={value} />
            <code className="font-mono text-meta text-muted-foreground">{value}</code>
          </div>
        ))}
      </div>
    </section>
  ),
}

/** The same raw value can mean something else in a domain. */
export const Domains: StoryObj = {
  render: () => (
    <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
      <dt className="text-muted-foreground">applied</dt>
      <dd className="flex gap-4"><Status value="applied" /><Status value="applied" domain="automation" /></dd>
      <dt className="text-muted-foreground">sent</dt>
      <dd className="flex gap-4"><Status value="sent" /><Status value="sent" domain="delivery" /></dd>
    </dl>
  ),
}

const ticketStatuses = ["new", "in_review", "needs_info", "planned", "in_progress", "resolved", "declined"]
const priorities = ["low", "normal", "high", "urgent"]

/** Support tickets (spec 015): status and the team's priority, each its own domain. */
export const Tickets: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        {ticketStatuses.map((value) => <Status key={value} value={value} domain="ticket" />)}
      </div>
      <div className="flex flex-wrap gap-4">
        {priorities.map((value) => <Status key={value} value={value} domain="priority" />)}
      </div>
    </div>
  ),
}
