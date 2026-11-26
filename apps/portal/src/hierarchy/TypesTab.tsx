import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { EntityPreset, EntityType, EntityTypeInput } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FieldGroup } from "@iot-os/ui/components/field"
import { SwitchField } from "@iot-os/ui/components/form-fields"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SearchableMultiSelect } from "@iot-os/ui/components/searchable-select"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { Confirm, EditorSheet, RequestError, SaveBar, TextField, fieldError } from "../components/forms"
import { namingHint } from "./model"
import { HierarchyTabs, refreshHierarchy, useEntityTypes, useHierarchyOrganization } from "./shared"

const outcomes: Record<EntityPreset["types"][number]["outcome"], string> = {
  add: "adds",
  merge: "merges into",
  present: "already has",
}

/** Hierarchy → Types: the types an organization uses, their rules, and presets that add more. */
export default function TypesTab() {
  const { org, capabilities } = useHierarchyOrganization()
  const client = useQueryClient()
  const types = useEntityTypes(org)
  const [editing, setEditing] = useState<EntityType | "new" | null>(null)
  const [removing, setRemoving] = useState<EntityType | null>(null)
  const all = types.data?.data ?? []
  const names = useMemo(() => new Map(all.map((type) => [type.key, type.name])), [all])
  const list = (keys: string[]) => keys.map((key) => names.get(key) ?? key).join(", ")
  const columns = useMemo<DataColumn<EntityType>[]>(
    () => [
      {
        id: "name",
        header: "Type",
        mobile: "title",
        sortable: true,
        searchable: true,
        value: (type) => type.name,
        cell: (type) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{type.name}</span>
            <span className="font-mono text-code text-muted-foreground">{type.key}</span>
          </span>
        ),
      },
      {
        id: "under",
        header: "Sits under",
        cell: (type) => (
          <span className="text-body">
            {[type.top_level ? "Top level" : null, type.parent_type_keys.length ? list(type.parent_type_keys) : null]
              .filter(Boolean)
              .join(" · ") || <span className="text-muted-foreground">Nowhere yet</span>}
          </span>
        ),
      },
      {
        id: "holds",
        header: "Holds",
        hideable: true,
        cell: (type) => (
          <span className="flex flex-wrap gap-1">
            {type.accepts_devices && <Badge variant="outline">Devices</Badge>}
            {type.carries_timezone && <Badge variant="outline">Time zone</Badge>}
            {type.carries_location && <Badge variant="outline">Location</Badge>}
            {type.member_type_keys.length > 0 && <Badge variant="outline">Members: {list(type.member_type_keys)}</Badge>}
          </span>
        ),
      },
      {
        id: "naming",
        header: "Naming",
        hideable: true,
        cell: (type) =>
          type.naming ? (
            <span className="font-mono text-code" title={namingHint(type)}>
              {type.naming.template}
            </span>
          ) : (
            <span className="text-muted-foreground">Any name</span>
          ),
      },
      {
        id: "used",
        header: "Entities",
        align: "end",
        sortable: true,
        summary: "sum",
        value: (type) => type.entities_count,
        cell: (type) => type.entities_count.toLocaleString(),
      },
    ],
    [names],
  )
  return (
    <>
      <CollectionPage
        title="Hierarchy"
        description="Types decide what may sit where, what holds devices, and how names are written."
        tabs={<HierarchyTabs org={org} />}
        actions={
          capabilities.manage_types && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <PlusIcon data-icon="inline-start" />
              New type
            </Button>
          )
        }
      >
        <DataTable
          id="entity-types"
          label="Entity types"
          noun={["type", "types"]}
          rows={types.data?.data}
          rowKey={(type) => type.key}
          rowLabel={(type) => type.name}
          columns={columns}
          defaultSort={[{ id: "name", desc: false }]}
          error={types.error ? <RequestError error={types.error} /> : undefined}
          rowActions={
            capabilities.manage_types
              ? (type) => (
                  <>
                    <DropdownMenuItem onSelect={() => setEditing(type)}>Edit rules</DropdownMenuItem>
                    {type.key !== "site" && (
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(type)}>
                        Delete type
                      </DropdownMenuItem>
                    )}
                  </>
                )
              : undefined
          }
          empty={<EmptyState inset title="No types yet" description="Apply a preset below, or create a type." />}
        />
        <Presets org={org} canManage={capabilities.manage_types} />
      </CollectionPage>
      {editing && (
        <TypeEditor
          org={org}
          type={editing === "new" ? null : editing}
          types={all}
          onClose={() => setEditing(null)}
          onSaved={() => void refreshHierarchy(client, org)}
        />
      )}
      <Confirm
        open={Boolean(removing)}
        title={`Delete ${removing?.name ?? "type"}?`}
        description="Only a type no entity uses and no other type refers to can be deleted."
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await api.deleteEntityType(org, removing.key)
          await refreshHierarchy(client, org)
          setRemoving(null)
        }}
      />
    </>
  )
}

/** Each preset with what applying it here would add, merge, or find already present. */
function Presets({ org, canManage }: { org: string; canManage: boolean }) {
  const client = useQueryClient()
  const presets = useQuery({ queryKey: ["entity-presets", org], queryFn: () => api.entityPresets(org) })
  const apply = useMutation({
    mutationFn: (preset: EntityPreset) => api.applyEntityPreset(org, preset.key),
    onSuccess: async (result, preset) => {
      await Promise.all([refreshHierarchy(client, org), client.invalidateQueries({ queryKey: ["entity-presets", org] })])
      toast.success(
        result.added.length || result.merged.length
          ? `${preset.name}: ${result.added.length} added, ${result.merged.length} merged`
          : `${preset.name} was already applied`,
      )
    },
  })
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Presets</PanelTitle>
        <PanelDescription className="text-body">
          Ready-made types for common industries. Applying one twice changes nothing; types you already have keep their
          names and gain the preset's rules.
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">
        <RequestError error={presets.error ?? apply.error} />
        <ul className="grid gap-3 lg:grid-cols-3">
          {(presets.data?.data ?? []).map((preset) => {
            const changes = preset.types.filter((type) => type.outcome !== "present")
            return (
              <li key={preset.key} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-body font-medium">{preset.name}</h3>
                  <p className="text-meta text-muted-foreground">{preset.description}</p>
                </div>
                <ul className="flex flex-col gap-0.5 text-meta">
                  {preset.types.map((type) => (
                    <li key={type.key} className={type.outcome === "present" ? "text-muted-foreground" : undefined}>
                      {outcomes[type.outcome][0]!.toUpperCase() + outcomes[type.outcome].slice(1)} {type.name}
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-auto self-start"
                    disabled={!changes.length || apply.isPending}
                    onClick={() => apply.mutate(preset)}
                  >
                    {!changes.length
                      ? "Applied"
                      : apply.isPending && apply.variables?.key === preset.key
                        ? "Applying…"
                        : `Apply ${preset.name}`}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </PanelContent>
    </Panel>
  )
}

type TypeValues = {
  key: string
  name: string
  top_level: boolean
  parent_type_keys: string[]
  member_type_keys: string[]
  accepts_devices: boolean
  carries_timezone: boolean
  carries_location: boolean
  naming_template: string
  naming_example: string
  naming_description: string
}

const keyFrom = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)

function TypeEditor({
  org,
  type,
  types,
  onClose,
  onSaved,
}: {
  org: string
  type: EntityType | null
  types: EntityType[]
  onClose: () => void
  onSaved: () => void
}) {
  const form = useForm<TypeValues>({
    defaultValues: {
      key: type?.key ?? "",
      name: type?.name ?? "",
      top_level: type?.top_level ?? false,
      parent_type_keys: type?.parent_type_keys ?? [],
      member_type_keys: type?.member_type_keys ?? [],
      accepts_devices: type?.accepts_devices ?? true,
      carries_timezone: type?.carries_timezone ?? false,
      carries_location: type?.carries_location ?? false,
      naming_template: type?.naming?.template ?? "",
      naming_example: type?.naming?.example ?? "",
      naming_description: type?.naming?.description ?? "",
    },
  })
  const [error, setError] = useState<unknown>(null)
  const dirty = form.formState.isDirty
  useUnsaved(dirty)
  const site = type?.key === "site"
  const values = form.watch()
  const others = types.filter((candidate) => candidate.key !== type?.key)
  const options = [...(type ? [{ value: type.key, label: `${type.name} (itself)` }] : []), ...others.map((candidate) => ({ value: candidate.key, label: candidate.name }))]
  const flag = (field: "top_level" | "accepts_devices" | "carries_timezone" | "carries_location") => ({
    checked: values[field],
    onCheckedChange: (checked: boolean) => form.setValue(field, checked, { shouldDirty: true }),
    disabled: site,
  })
  return (
    <EditorSheet
      title={type ? `Edit ${type.name}` : "New type"}
      description={
        site
          ? "Sites always sit at the top level, hold devices, and carry a time zone and a location."
          : "Rules apply to changes from now on; entities already outside them keep working and are marked."
      }
      dirty={dirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (submitted) => {
          setError(null)
          const input: EntityTypeInput = {
            key: submitted.key || keyFrom(submitted.name),
            name: submitted.name.trim(),
            parent_type_keys: submitted.parent_type_keys,
            member_type_keys: submitted.member_type_keys,
            naming_template: submitted.naming_template.trim() || null,
            naming_example: submitted.naming_example.trim() || null,
            naming_description: submitted.naming_description.trim() || null,
            ...(site
              ? {}
              : {
                  top_level: submitted.top_level,
                  accepts_devices: submitted.accepts_devices,
                  carries_timezone: submitted.carries_timezone,
                  carries_location: submitted.carries_location,
                }),
          }
          try {
            if (type) {
              const { key: _key, ...changes } = input
              await api.updateEntityType(org, type.key, changes)
            } else await api.createEntityType(org, input)
            form.reset(submitted)
            onSaved()
            onClose()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            <TextField label="Name" required placeholder="Feeder" error={fieldError(error, "name")} {...form.register("name")} />
            {!type && (
              <TextField
                label="Key"
                optional
                placeholder={keyFrom(values.name) || "feeder"}
                help={fieldError(error, "key") ? undefined : "Lowercase letters, digits and _. Fixed once created."}
                error={fieldError(error, "key")}
                {...form.register("key")}
              />
            )}
            <SwitchField label="Top level" description="It may sit at the top of the tree." {...flag("top_level")} />
            <SearchableMultiSelect
              label="Sits under"
              values={values.parent_type_keys}
              options={options}
              onChange={(keys) => form.setValue("parent_type_keys", keys, { shouldDirty: true })}
              optional
              placeholder="Choose parent types"
              help={values.parent_type_keys.length ? labelsOf(values.parent_type_keys, options) : "No parent type: only the top level, if allowed."}
              error={fieldError(error, "parent_type_keys")}
            />
            <SwitchField label="Holds devices" description="Devices can be placed here." {...flag("accepts_devices")} />
            <SwitchField label="Carries a time zone" description="Days and shifts of devices below start in its zone." {...flag("carries_timezone")} />
            <SwitchField label="Carries a location" description="An address and coordinates." {...flag("carries_location")} />
            <SearchableMultiSelect
              label="Groups members of"
              values={values.member_type_keys}
              options={others.map((candidate) => ({ value: candidate.key, label: candidate.name }))}
              onChange={(keys) => form.setValue("member_type_keys", keys, { shouldDirty: true })}
              optional
              placeholder="Choose member types"
              help="A group covers its members' devices without moving them, e.g. a division grouping feeders."
              error={fieldError(error, "member_type_keys")}
            />
            <TextField
              label="Naming template"
              optional
              placeholder="Feeder<number>"
              help={
                fieldError(error, "naming_template")
                  ? undefined
                  : "Literal text plus <number>, <letter>, <letters> or <text>. Leave empty for any name."
              }
              error={fieldError(error, "naming_template")}
              className="font-mono"
              {...form.register("naming_template")}
            />
            {values.naming_template.trim() && (
              <>
                <TextField label="Example" optional placeholder="Feeder12" error={fieldError(error, "naming_example")} {...form.register("naming_example")} />
                <TextField label="What it means" optional placeholder="Feeder and its number" error={fieldError(error, "naming_description")} {...form.register("naming_description")} />
              </>
            )}
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar dirty={dirty} busy={form.formState.isSubmitting} onCancel={onClose} label={type ? "Save rules" : "Create type"} />
      </form>
    </EditorSheet>
  )
}

function labelsOf(keys: string[], options: { value: string; label: string }[]) {
  return keys.map((key) => options.find((option) => option.value === key)?.label ?? key).join(", ")
}
