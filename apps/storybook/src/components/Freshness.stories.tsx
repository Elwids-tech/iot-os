import type { Meta, StoryObj } from "@storybook/react-vite"
import { Freshness, RelativeTime } from "@iot-os/ui/components/freshness"

const meta: Meta<typeof Freshness> = { title: "Components/Freshness", component: Freshness }
export default meta

const now = Date.parse("2026-10-10T12:00:00Z")
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

/**
 * When something last reported, rated against its expected interval. Late
 * means older than twice the interval and says so in text for screen readers.
 */
export const States: StoryObj = {
  render: () => (
    <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-3 text-body">
      <dt className="text-muted-foreground">Fresh</dt>
      <dd><Freshness at={ago(1)} expectedSeconds={60} now={now} /></dd>
      <dt className="text-muted-foreground">Late</dt>
      <dd><Freshness at={ago(6 * 86400)} expectedSeconds={60} now={now} /></dd>
      <dt className="text-muted-foreground">No interval</dt>
      <dd><Freshness at={ago(3 * 86400)} now={now} /></dd>
      <dt className="text-muted-foreground">Never</dt>
      <dd><Freshness at={null} now={now} /></dd>
    </dl>
  ),
}

/** The plain relative time. `bare` drops "ago" for dense readouts; `never={null}` renders nothing. */
export const Relative: StoryObj = {
  render: () => (
    <dl className="grid max-w-md grid-cols-[10rem_1fr] gap-y-3 text-body">
      <dt className="text-muted-foreground">Default</dt>
      <dd><RelativeTime at={ago(19 * 60)} now={now} /></dd>
      <dt className="text-muted-foreground">Bare, mono</dt>
      <dd><RelativeTime at={ago(4)} now={now} bare className="font-mono" /></dd>
      <dt className="text-muted-foreground">UTC title</dt>
      <dd><RelativeTime at={ago(2 * 3600)} now={now} timezone="utc" /></dd>
      <dt className="text-muted-foreground">Missing</dt>
      <dd><RelativeTime at={null} never="Not confirmed" /></dd>
    </dl>
  ),
}
