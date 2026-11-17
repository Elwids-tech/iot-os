import * as React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { SegmentedControl, SegmentedControlItem } from "@iot-os/ui/components/segmented-control"
import { Tabs, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"

const meta: Meta<typeof SegmentedControl> = { title: "Components/SegmentedControl", component: SegmentedControl }
export default meta

/** A list filter or table view: one of a few, with optional counts. The selected segment is primary. */
export const Filter: StoryObj = {
  render: function Render() {
    const [value, setValue] = React.useState("all")
    return (
      <SegmentedControl aria-label="Status" value={value} onValueChange={setValue}>
        <SegmentedControlItem value="all" count={12}>All</SegmentedControlItem>
        <SegmentedControlItem value="draft" count={3}>Draft</SegmentedControlItem>
        <SegmentedControlItem value="live" count={8}>Live</SegmentedControlItem>
        <SegmentedControlItem value="archived" count={1}>Archived</SegmentedControlItem>
      </SegmentedControl>
    )
  },
}

/** Many options wrap onto more lines instead of widening the row. */
export const Wrapping: StoryObj = {
  render: function Render() {
    const [value, setValue] = React.useState("6h")
    return (
      <div className="w-56">
        <SegmentedControl wrap aria-label="Quick ranges" value={value} onValueChange={setValue}>
          {["15m", "1h", "6h", "24h", "7d", "30d", "90d"].map((range) => (
            <SegmentedControlItem key={range} value={range}>{range}</SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
    )
  },
}

export const Disabled: StoryObj = {
  render: () => (
    <SegmentedControl aria-label="Trail window" value="24h" disabled>
      <SegmentedControlItem value="1h">1h</SegmentedControlItem>
      <SegmentedControlItem value="24h">24h</SegmentedControlItem>
    </SegmentedControl>
  ),
}

/** The two looks: an underline swaps what you see; a filled segment picks a value. The panel switch in the middle is tabs drawn as segments. */
export const Roles: StoryObj = {
  render: () => (
    <div className="flex flex-col items-start gap-6">
      <Tabs defaultValue="overview">
        <TabsList variant="line" aria-label="Device sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="readings">Readings</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs defaultValue="fields">
        <TabsList aria-label="Change view">
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
      </Tabs>
      <SegmentedControl aria-label="Condition" defaultValue="active">
        <SegmentedControlItem value="active">Active</SegmentedControlItem>
        <SegmentedControlItem value="cleared">Cleared</SegmentedControlItem>
        <SegmentedControlItem value="all">All</SegmentedControlItem>
      </SegmentedControl>
    </div>
  ),
}
