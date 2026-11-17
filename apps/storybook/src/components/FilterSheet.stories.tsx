import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { Field, FieldLabel } from "@iot-os/ui/components/field"
import { FilterSheet } from "@iot-os/ui/components/filter-sheet"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { SegmentedControl, SegmentedControlItem } from "@iot-os/ui/components/segmented-control"

const meta: Meta<typeof FilterSheet> = { title: "Components/FilterSheet", component: FilterSheet }
export default meta

/**
 * A list's filters on a phone: one Filters button with the count of active filters,
 * opening a bottom sheet with every filter the computer layout has. Changes apply as
 * they are made; Clear filters appears while any is set. CollectionPage's `filters` and
 * DataTable use it below 768 px; a page with its own toolbar (Alerts) uses it directly.
 */
function AlertFilters() {
  const [condition, setCondition] = useState("active")
  const [unacknowledged, setUnacknowledged] = useState(true)
  const [device, setDevice] = useState("")
  const [search, setSearch] = useState("")
  const count = Number(condition !== "active") + Number(unacknowledged) + Number(Boolean(device))
  return (
    <FilterSheet
      title="Filter alerts"
      count={count}
      onReset={() => {
        setCondition("active")
        setUnacknowledged(false)
        setDevice("")
      }}
    >
      <SegmentedControl
        aria-label="Condition"
        value={condition}
        onValueChange={(value) => value && setCondition(value)}
      >
        <SegmentedControlItem value="active">Active</SegmentedControlItem>
        <SegmentedControlItem value="cleared">Cleared</SegmentedControlItem>
        <SegmentedControlItem value="all">All</SegmentedControlItem>
      </SegmentedControl>
      <Field orientation="horizontal" className="w-auto">
        <Checkbox id="story-unacknowledged" checked={unacknowledged} onCheckedChange={(value) => setUnacknowledged(value === true)} />
        <FieldLabel htmlFor="story-unacknowledged" className="font-normal">Unacknowledged only</FieldLabel>
      </Field>
      <SearchableSelect
        label="Device"
        className="w-full"
        value={device}
        options={[
          { value: "", label: "All devices" },
          { value: "meter", label: "Energy meter" },
          { value: "tracker", label: "GPS tracker" },
        ].filter((option) => option.label.toLowerCase().includes(search.toLowerCase()))}
        onChange={setDevice}
        search={search}
        onSearchChange={setSearch}
      />
    </FilterSheet>
  )
}

export const Phone: StoryObj = {
  globals: { viewport: { value: "phone", isRotated: false } },
  render: () => <AlertFilters />,
}
