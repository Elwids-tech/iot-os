import type { Meta, StoryObj } from "@storybook/react-vite"
import { AllowanceMeter } from "@iot-os/ui/components/allowance-meter"

const meta: Meta<typeof AllowanceMeter> = { title: "Components/AllowanceMeter", component: AllowanceMeter }
export default meta

const now = Date.parse("2026-11-08T12:00:00Z")
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

/**
 * One billing allowance (specs 028 and 029): within it under 80%, near it from 80%, used
 * up at it. Alerts and data points past it are overage and keep going; devices are a
 * level that can sit over a lowered limit. Unlimited only counts.
 */
export const States: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <AllowanceMeter label="Alerts this month" count={412} allowance={null} noun={["alert", "alerts"]} />
      <AllowanceMeter label="Alerts this month" count={500} allowance={1000} noun={["alert", "alerts"]} />
      <AllowanceMeter label="SMS this month" count={170} allowance={200} noun={["SMS", "SMS"]} />
      <AllowanceMeter label="Alerts this month" count={1240} allowance={1000} overage={240} noun={["alert", "alerts"]} />
      <AllowanceMeter label="Alerts this month, allowance raised" count={1240} allowance={2000} overage={240} noun={["alert", "alerts"]} />
      <AllowanceMeter label="Active devices" kind="level" count={52} allowance={50} noun={["device", "devices"]} />
      <AllowanceMeter label="Active devices" kind="level" count={50} allowance={50} noun={["device", "devices"]} />
    </div>
  ),
}

/**
 * An earlier month shows its count and overage only: its allowance may have changed
 * since, and the API keeps no history of it.
 */
export const EarlierMonth: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <AllowanceMeter label="Alerts" count={1240} allowance={2000} overage={240} noun={["alert", "alerts"]} earlier />
      <AllowanceMeter label="Peak devices" kind="level" count={48} allowance={50} noun={["device", "devices"]} earlier />
    </div>
  ),
}

/**
 * Data points come from the runtime's reports: provisional until the month is final,
 * late once the API says `stale` or the report ages past its `stale_after_seconds`.
 */
export const Freshness: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <AllowanceMeter label="Data points this month" count={812_345} allowance={1_000_000} noun={["data point", "data points"]} freshness={{ reportedAt: ago(40), final: false }} now={now} />
      <AllowanceMeter label="Data points this month" count={812_345} allowance={1_000_000} noun={["data point", "data points"]} freshness={{ reportedAt: ago(12 * 60), final: false }} now={now} />
      <AllowanceMeter label="Data points in October" count={1_204_118} allowance={1_000_000} overage={204_118} noun={["data point", "data points"]} freshness={{ reportedAt: ago(30), final: true }} now={now} />
      <AllowanceMeter label="Data points this month" count={0} allowance={1_000_000} noun={["data point", "data points"]} freshness={{ reportedAt: null, final: false }} now={now} />
      <AllowanceMeter label="Data points this month, server says stale" count={812_345} allowance={1_000_000} noun={["data point", "data points"]} freshness={{ reportedAt: ago(90), final: false, stale: true, staleAfterSeconds: 300 }} now={now} />
    </div>
  ),
}
