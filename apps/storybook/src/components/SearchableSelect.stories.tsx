import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"

const meta: Meta<typeof SearchableSelect> = { title: "Components/SearchableSelect", component: SearchableSelect }
export default meta

const DASHBOARDS = [
  { value: "energy", label: "Energy overview" },
  { value: "boilers", label: "Boiler room" },
  { value: "fleet", label: "Fleet tracking" },
]

function Picker({ creatable }: { creatable?: boolean }) {
  const [options, setOptions] = useState(DASHBOARDS)
  const [value, setValue] = useState("")
  const [search, setSearch] = useState("")
  return (
    <div className="max-w-sm">
      <SearchableSelect
        label="Dashboard"
        value={value}
        onChange={setValue}
        search={search}
        onSearchChange={setSearch}
        placeholder="Choose a dashboard"
        emptyText="No dashboards match."
        help={creatable ? "Type a new name to create a dashboard." : undefined}
        options={options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))}
        onCreate={
          creatable
            ? (name) => {
                const option = { value: name.toLowerCase(), label: name }
                setOptions((list) => [...list, option])
                setValue(option.value)
              }
            : undefined
        }
        createLabel={(name) => `New dashboard “${name}”`}
      />
    </div>
  )
}

/** Search sits inside the selector; the caller filters the options it passes. */
export const Default: StoryObj = { render: () => <Picker /> }

/**
 * With `onCreate`, typed text that matches no option's label offers a create item after the
 * matches, so a new entry is made without leaving the picker.
 */
export const Creatable: StoryObj = { render: () => <Picker creatable /> }
