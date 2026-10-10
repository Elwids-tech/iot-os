import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FieldError } from "@iot-os/ui/components/field"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { api } from "../lib/api"

/**
 * Stored unit picker over the shared unit catalogue. Catalogue units let charts
 * convert and compare values; a custom unit stays possible but has no quantity.
 */
export function UnitField({
  value,
  onChange,
  disabled,
  locked,
  error,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Published parameters may only switch to another spelling of the same unit. */
  locked?: boolean
  error?: string
}) {
  const [search, setSearch] = useState("")
  const catalogue = useQuery({
    queryKey: ["unit-catalogue"],
    queryFn: () => api.units(),
    staleTime: Infinity,
  })
  const quantities = catalogue.data?.quantities ?? {}
  const units = catalogue.data?.units ?? []
  const options = useMemo(() => {
    const typed = search.trim()
    const needle = typed.toLowerCase()
    const matches = needle
      ? units.filter((unit) =>
          [unit.symbol, unit.name, ...unit.aliases, quantities[unit.quantity]?.label]
            .some((text) => text?.toLowerCase().includes(needle)),
        )
      : units
    const known = units.some(
      (unit) => unit.symbol === typed || unit.aliases.includes(typed),
    )
    return [
      { value: "", label: "No unit" },
      ...(typed && !known
        ? [{ value: typed, label: `Use “${typed}” as a custom unit` }]
        : []),
      ...matches.map((unit) => ({
        value: unit.symbol,
        label: `${unit.symbol} · ${unit.name} · ${quantities[unit.quantity]?.label ?? unit.quantity}`,
      })),
    ]
  }, [units, quantities, search])
  const selected = units.find((unit) => unit.symbol === value)
  return (
    <div className="flex flex-col gap-2">
      <SearchableSelect
        label="Stored unit"
        value={value}
        options={options}
        onChange={onChange}
        search={search}
        onSearchChange={setSearch}
        loading={catalogue.isLoading}
        disabled={disabled}
        placeholder="No unit"
        emptyText="No catalogue unit matches. Type the unit to use it as a custom unit."
        selectedLabel={
          !value
            ? "No unit"
            : selected
              ? `${selected.symbol} · ${selected.name}`
              : `${value} (custom unit)`
        }
        help={
          locked
            ? "Published parameters keep their unit. You can only switch to another spelling of the same unit."
            : selected
              ? `${quantities[selected.quantity]?.label ?? selected.quantity}. Charts can convert and compare it with other ${(quantities[selected.quantity]?.label ?? selected.quantity).toLowerCase()} units.`
              : "Choose a catalogue unit so charts can convert and compare values. Custom units are allowed."
        }
      />
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}
