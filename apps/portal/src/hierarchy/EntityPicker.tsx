import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { EntitySummary } from "@iot-os/api-client"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { api } from "../lib/api"
import { entityLabel } from "./shared"

/**
 * Chooses an entity by searching names and paths; each option shows where it sits. Without
 * a search it offers the top level. `none` adds a first option with an empty value.
 */
export function EntityPicker({
  org,
  label,
  value,
  onChange,
  selectedLabel,
  none,
  accept,
  help,
  error,
  optional,
  labelHidden,
  disabled,
  placeholder = "Choose a place",
  className,
}: {
  org: string
  label: string
  value: string
  onChange: (uuid: string, entity: EntitySummary | null) => void
  /** The current value's label when it may not be in the loaded options, e.g. a device's path. */
  selectedLabel?: string
  none?: string
  /** Leaves out entities that cannot be chosen here, e.g. types that take no devices. */
  accept?: (entity: EntitySummary) => boolean
  help?: string
  error?: string
  optional?: boolean
  labelHidden?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const typed = search.trim()
  const results = useQuery({
    queryKey: ["entities", org, "picker", typed, page],
    queryFn: () => (typed ? api.searchEntities(org, typed, page) : api.entities(org, { page })),
    placeholderData: keepPreviousData,
    enabled: Boolean(org) && !disabled,
  })
  const rows = (results.data?.data ?? []).filter((entity) => !accept || accept(entity))
  const options = [
    ...(none ? [{ value: "", label: none }] : []),
    ...rows.map((entity) => ({ value: entity.uuid, label: entityLabel(entity) })),
  ]
  return (
    <SearchableSelect
      label={label}
      value={value}
      options={options}
      onChange={(uuid) => onChange(uuid, rows.find((entity) => entity.uuid === uuid) ?? null)}
      search={search}
      onSearchChange={(next) => {
        setSearch(next)
        setPage(1)
      }}
      loading={results.isFetching}
      selectedLabel={value ? selectedLabel : undefined}
      placeholder={placeholder}
      emptyText={typed ? "Nothing in the hierarchy matches." : "The hierarchy is empty."}
      page={page}
      hasNextPage={Boolean(results.data?.meta && results.data.meta.current_page < results.data.meta.last_page)}
      onPageChange={setPage}
      help={help}
      error={error}
      optional={optional}
      labelHidden={labelHidden}
      disabled={disabled}
      className={className}
    />
  )
}
