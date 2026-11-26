import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import type { Entity, EntityInput, EntitySummary } from "@iot-os/api-client"
import { FieldGroup } from "@iot-os/ui/components/field"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { Choice, EditorSheet, RequestError, SaveBar, TextField, fieldError } from "../components/forms"
import { TimezoneField } from "../devices/TimezoneField"
import { allowedTypes, namingHint } from "./model"
import { useEntityTypes } from "./shared"

type Values = {
  type_key: string
  name: string
  path_name: string
  description: string
  timezone: string
  address: string
  latitude: string
  longitude: string
}

/** Waits until typing pauses before asking the server. */
function useDebounced<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * Creates an entity under `parent` (the top level when null), or edits `entity`. Only the
 * types the parent allows are offered; the path name is suggested from the name.
 */
export function EntityForm({
  org,
  parent,
  entity,
  onClose,
  onSaved,
}: {
  org: string
  parent?: Pick<EntitySummary, "uuid" | "name" | "path" | "type"> | null
  entity?: Entity
  onClose: () => void
  onSaved: (entity: Entity) => void
}) {
  const types = useEntityTypes(org)
  // An edit's parent type is not on the entity page's ancestors: ask for the parent.
  const parentEntity = useQuery({
    queryKey: ["entity", org, entity?.parent_uuid],
    queryFn: () => api.entity(org, entity!.parent_uuid!),
    enabled: Boolean(entity?.parent_uuid),
  })
  const parentName = entity ? entity.ancestors[entity.ancestors.length - 1]?.name : parent?.name
  const parentPath = entity ? entity.path.split("/").slice(0, -1).join("/") : (parent?.path ?? "")
  // Undefined while an edit's parent loads; null at the top level.
  const placedUnder = entity
    ? entity.parent_uuid
      ? parentEntity.data
        ? { type: parentEntity.data.type }
        : undefined
      : null
    : (parent ?? null)
  const all = types.data?.data ?? []
  const choices = placedUnder === undefined ? [] : allowedTypes(all, placedUnder)
  // An entity outside the rules keeps its own type on the list.
  const options =
    entity && !choices.some((type) => type.key === entity.type.key)
      ? [...choices, ...all.filter((type) => type.key === entity.type.key)]
      : choices
  const form = useForm<Values>({
    defaultValues: {
      type_key: entity?.type.key ?? "",
      name: entity?.name ?? "",
      path_name: entity?.path_name ?? "",
      description: entity?.description ?? "",
      timezone: entity?.timezone ?? "",
      address: entity?.address ?? "",
      latitude: entity?.latitude?.toString() ?? "",
      longitude: entity?.longitude?.toString() ?? "",
    },
  })
  // One allowed type is chosen for the person.
  useEffect(() => {
    if (!entity && !form.getValues("type_key") && choices.length === 1)
      form.setValue("type_key", choices[0]!.key, { shouldDirty: true })
  }, [entity, choices, form])
  const [error, setError] = useState<unknown>(null)
  const dirty = form.formState.isDirty
  useUnsaved(dirty)
  const typeKey = form.watch("type_key")
  const type = all.find((candidate) => candidate.key === typeKey)
  const name = useDebounced(form.watch("name").trim())
  const pathNameTouched = Boolean(form.formState.dirtyFields.path_name)
  const suggestion = useQuery({
    queryKey: ["entities", org, "path-name", name],
    queryFn: () => api.entityPathNameSuggestion(org, name),
    enabled: Boolean(name) && !entity,
  })
  const suggested = suggestion.data?.path_name ?? ""
  const timezone = form.watch("timezone")
  const where = parentPath ? `${parentPath}/` : ""
  return (
    <EditorSheet
      title={entity ? `Edit ${entity.name}` : parent ? `Add to ${parent.name}` : "New top-level entity"}
      description={
        entity
          ? "Renaming changes the paths below it; devices and their history stay."
          : "Only the types allowed here are offered. Change the rules under Types."
      }
      dirty={dirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          const input: EntityInput = {
            type_key: values.type_key,
            name: values.name.trim(),
            path_name: values.path_name.trim() || (entity ? entity.path_name : null),
            description: values.description.trim() || null,
            ...(type?.carries_timezone ? { timezone: values.timezone || null } : {}),
            ...(type?.carries_location
              ? {
                  address: values.address.trim() || null,
                  latitude: values.latitude === "" ? null : Number(values.latitude),
                  longitude: values.longitude === "" ? null : Number(values.longitude),
                }
              : {}),
          }
          try {
            const { type_key, ...changes } = input
            const saved = entity
              ? await api.updateEntity(org, entity.uuid, type_key === entity.type.key ? changes : input)
              : await api.createEntity(org, { ...input, parent_uuid: parent?.uuid ?? null })
            form.reset(values)
            onSaved(saved)
            onClose()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            <Choice
              label="Type"
              value={typeKey}
              placeholder={types.isLoading ? "Loading types…" : "Choose a type"}
              options={options.map((option) => ({ value: option.key, label: option.name }))}
              onChange={(key) => form.setValue("type_key", key, { shouldDirty: true })}
              disabled={types.isLoading}
              help={
                fieldError(error, "type_key") ??
                fieldError(error, "parent_uuid") ??
                (options.length
                  ? parentName
                    ? `Types allowed under ${parentName}.`
                    : "Types allowed at the top level."
                  : types.isLoading
                    ? undefined
                    : "No type may sit here. Add one under Types, or allow it here.")
              }
            />
            <TextField
              label="Name"
              required
              placeholder={type?.naming?.example ?? "Line 2"}
              help={namingHint(type)}
              error={fieldError(error, "name")}
              {...form.register("name")}
            />
            <TextField
              label="Path name"
              optional={!entity}
              placeholder={suggested || "Suggested from the name"}
              help={
                fieldError(error, "path_name")
                  ? undefined
                  : `How it appears in paths: ${where}${form.watch("path_name") || suggested || "…"}. Letters, digits, - and _.`
              }
              error={fieldError(error, "path_name")}
              {...form.register("path_name")}
            />
            {!entity && !pathNameTouched && suggested && (
              <p className="-mt-2 text-meta text-muted-foreground">Leave it empty to use {suggested}.</p>
            )}
            <TextField label="Description" optional error={fieldError(error, "description")} {...form.register("description")} />
            {type?.carries_timezone && (
              <TimezoneField
                label="Time zone"
                value={timezone}
                allowNone
                noneLabel="From the place above, else the organization"
                help={fieldError(error, "timezone") ?? "Days, months and shifts of devices here start in this zone."}
                onChange={(zone) => form.setValue("timezone", zone, { shouldDirty: true })}
              />
            )}
            {type?.carries_location && (
              <>
                <TextField label="Address" optional error={fieldError(error, "address")} {...form.register("address")} />
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Latitude" type="number" step="any" min="-90" max="90" optional error={fieldError(error, "latitude")} {...form.register("latitude")} />
                  <TextField label="Longitude" type="number" step="any" min="-180" max="180" optional error={fieldError(error, "longitude")} {...form.register("longitude")} />
                </FieldGroup>
              </>
            )}
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={dirty}
          busy={form.formState.isSubmitting}
          disabled={!typeKey}
          onCancel={onClose}
          label={entity ? "Save" : "Create"}
        />
      </form>
    </EditorSheet>
  )
}
