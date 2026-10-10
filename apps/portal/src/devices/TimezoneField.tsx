import { useMemo, useState } from "react"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"

/** Current UTC offset of an IANA zone, for example "UTC−07:00". */
export function utcOffset(zone: string, at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((item) => item.type === "timeZoneName")?.value
    return !part || part === "GMT" ? "UTC±00:00" : part.replace("GMT", "UTC").replace("-", "−")
  } catch {
    return ""
  }
}

function zones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf?.("timeZone") ?? []
  return supported.includes("UTC") ? supported : ["UTC", ...supported]
}

/** IANA time zone picker; search covers the zone name, city and offset. */
export function TimezoneField({
  label,
  value,
  onChange,
  disabled,
  help,
  allowNone,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  help?: string
  /** Offer "Not set" (UTC) as an option. */
  allowNone?: boolean
}) {
  const [search, setSearch] = useState("")
  const all = useMemo(() => zones().map((zone) => ({ zone, offset: utcOffset(zone) })), [])
  const options = useMemo(() => {
    const needle = search.trim().toLowerCase().replace(/\s+/g, "_")
    const matches = needle
      ? all.filter(({ zone, offset }) => zone.toLowerCase().includes(needle) || offset.toLowerCase().includes(needle))
      : all
    return [
      ...(allowNone ? [{ value: "", label: "Not set (UTC)" }] : []),
      ...matches.slice(0, 200).map(({ zone, offset }) => ({
        value: zone,
        label: `${zone.replaceAll("_", " ")} · ${offset}`,
      })),
    ]
  }, [all, search, allowNone])
  return (
    <SearchableSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      search={search}
      onSearchChange={setSearch}
      disabled={disabled}
      help={help}
      placeholder={allowNone ? "Not set (UTC)" : "Choose a time zone"}
      selectedLabel={value ? `${value.replaceAll("_", " ")} · ${utcOffset(value)}` : undefined}
      emptyText="No time zone matches. Search by city, for example Vancouver."
    />
  )
}
