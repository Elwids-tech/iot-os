import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FieldGroup } from "@iot-os/ui/components/field"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { StatusMark } from "@iot-os/ui/components/status-mark"
import { api } from "../../lib/api"
import { RequestError } from "../../components/forms"

export type MoveTarget = { uuid: string; name: string }

/**
 * The organizations of the billing account the person may move devices into. An owner
 * of the account with room for another organization can create one by typing its name;
 * they become its Organization Admin and the move continues there (FR-003).
 */
export function WhereTo({
  org,
  value,
  onChange,
}: {
  org: string
  value: MoveTarget | null
  onChange: (target: MoveTarget) => void
}) {
  const cache = useQueryClient()
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const targets = useQuery({ queryKey: ["device-move-targets", org], queryFn: () => api.deviceMoveTargets(org) })
  const options = (targets.data?.data ?? [])
    .filter((target) => target.name.toLowerCase().includes(search.trim().toLowerCase()))
    .map((target) => ({ value: target.uuid, label: target.name }))
  const account = targets.data?.new_organization?.billing_account_uuid
  const create = async (name: string) => {
    if (!account) return
    setCreating(true)
    setError(null)
    try {
      const created = await api.createOwnedOrganization(account, { name: name.trim() })
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["device-move-targets", org] }),
        cache.invalidateQueries({ queryKey: ["session"] }),
      ])
      onChange({ uuid: created.uuid, name: created.name })
    } catch (reason) {
      setError(reason)
    } finally {
      setCreating(false)
    }
  }
  const none = targets.data && targets.data.data.length === 0 && !account
  return (
    <FieldGroup>
      <SearchableSelect
        label="Organization"
        value={value?.uuid ?? ""}
        selectedLabel={value?.name}
        options={options}
        search={search}
        onSearchChange={setSearch}
        onChange={(uuid) => {
          const target = targets.data?.data.find((candidate) => candidate.uuid === uuid)
          if (target) onChange(target)
        }}
        loading={targets.isFetching || creating}
        disabled={creating}
        placeholder="Choose an organization"
        emptyText={account ? "Type a name to create a new organization." : "No organization matches."}
        help={
          account
            ? "Organizations of this billing account where you can move devices. Type a new name to create one."
            : "Organizations of this billing account where you can move devices."
        }
        onCreate={account ? (name) => void create(name) : undefined}
        createLabel={(name) => `New organization “${name.trim()}”`}
      />
      {none && (
        <StatusMark tone="muted">
          You can move devices only to another organization of this billing account where you can move devices too.
        </StatusMark>
      )}
      <RequestError error={targets.error ?? error} />
    </FieldGroup>
  )
}
