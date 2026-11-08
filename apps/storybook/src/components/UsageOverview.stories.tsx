import type { Meta, StoryObj } from "@storybook/react-vite"
import { UsageMeters, UsagePanel, type UsageFigure } from "@iot-os/ui/components/usage-overview"

const meta: Meta = { title: "Components/UsageOverview" }
export default meta

const now = Date.parse("2026-11-08T12:00:00Z")
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()
const plant = { organization_uuid: "a0000000-0000-4000-8000-000000000001", name: "North plant" }
const depot = { organization_uuid: "a0000000-0000-4000-8000-000000000002", name: "South depot" }

const month: UsageFigure[] = [
  { kind: "alerts", month: "2026-11-01", count: 860, allowance: 1000, overage: 0, organizations: [{ ...plant, count: 610 }, { ...depot, count: 250 }] },
  { kind: "sms", month: "2026-11-01", count: 40, allowance: 200, overage: 0, organizations: [{ ...plant, count: 40 }] },
  { kind: "devices", month: "2026-11-01", count: 52, allowance: 50, overage: 0, peak_this_month: 54, organizations: [{ ...plant, count: 40 }, { ...depot, count: 12 }] },
  {
    kind: "data_points",
    month: "2026-11-01",
    count: 412_000,
    allowance: 1_000_000,
    overage: 0,
    final: false,
    reported_at: ago(40),
    organizations: [{ ...plant, count: 300_000 }, { ...depot, count: 112_000 }],
  },
]

const october: UsageFigure[] = [
  { kind: "alerts", month: "2026-10-01", count: 1240, allowance: 1000, overage: 240, organizations: [{ ...plant, count: 1240 }] },
  { kind: "sms", month: "2026-10-01", count: 12, allowance: 200, overage: 0, organizations: [{ ...plant, count: 12 }] },
  { kind: "devices", month: "2026-10-01", count: 48, allowance: 50, overage: 0, organizations: [{ ...plant, count: 48 }] },
  { kind: "data_points", month: "2026-10-01", count: 980_000, allowance: 1_000_000, overage: 0, final: true, reported_at: ago(30), organizations: [{ ...plant, count: 980_000 }] },
]

/**
 * A billing account's Usage panel (specs 028 and 029): this month comes with the page;
 * an earlier month loads when picked. Devices are over a lowered limit, alerts are near
 * their allowance, data points are provisional.
 */
export const Panel: StoryObj = {
  render: () => (
    <div className="max-w-5xl">
      <UsagePanel
        id="story-usage"
        description="Months are UTC."
        figures={month}
        load={(picked) => new Promise((resolve) => setTimeout(() => resolve(picked === "2026-10" ? october : []), 400))}
        now={now}
      />
    </div>
  ),
}

/** The meters alone, for an unlimited account whose runtime has not reported for twelve minutes. */
export const Unlimited: StoryObj = {
  render: () => (
    <div className="max-w-5xl">
      <UsageMeters
        now={now}
        figures={[
          { kind: "alerts", month: "2026-11-01", count: 412, allowance: null, overage: 0 },
          { kind: "devices", month: "2026-11-01", count: 18, allowance: null, overage: 0, peak_this_month: 21 },
          { kind: "data_points", month: "2026-11-01", count: 52_118, allowance: null, overage: 0, final: false, reported_at: ago(12 * 60) },
        ]}
      />
    </div>
  ),
}
