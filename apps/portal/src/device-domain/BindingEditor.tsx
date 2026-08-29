import { useEffect, useState, type FormEvent } from "react"
import type {
  DeviceProfileDocument,
  DeviceProfileResource,
  NativeMqttBindingDocument,
  NativeMqttBindingResource,
} from "@iot-os/api-client"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@iot-os/ui/components/accordion"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@iot-os/ui/components/alert-dialog"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@iot-os/ui/components/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@iot-os/ui/components/select"
import { Spinner } from "@iot-os/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { Textarea } from "@iot-os/ui/components/textarea"
import { AlertTriangleIcon, BracesIcon, CableIcon, ListRestartIcon, PlusIcon, RadioTowerIcon, SaveIcon, Trash2Icon } from "lucide-react"
import {
  AddButton,
  BooleanField,
  CalibrationEditor,
  EditorReadOnlyProvider,
  JsonPreview,
  NumberField,
  RepeaterActions,
  SelectField,
  StableId,
  TextField,
  useEditorReadOnly,
} from "./EditorPrimitives"
import {
  createChannel,
  createCommandMapping,
  createEventMapping,
  createParameterMapping,
  createPropertyMapping,
  dataTypes,
  invalidPolicies,
  missingPolicies,
  moveItem,
  replaceItem,
  slugKey,
  synchronizeBinding,
  type BindingChannel,
  type CalibrationOperation,
  type CommandMapping,
  type EventMapping,
  type ParameterMapping,
  type ProfileCommand,
  type ProfileEvent,
  type ProfileProperty,
  type PropertyMapping,
} from "./model"

type BindingEditorProps = {
  profiles: DeviceProfileResource[]
  bindings: NativeMqttBindingResource[]
  draft: NativeMqttBindingDocument | null
  selectedUuid: string | null
  selectedResource: NativeMqttBindingResource | null
  error: string | null
  saving: boolean
  onDraftChange: (draft: NativeMqttBindingDocument) => void
  onSelect: (uuid: string) => void
  onNew: (profile: DeviceProfileDocument) => void
  onSave: (draft: NativeMqttBindingDocument) => Promise<void>
  onDelete: () => Promise<void>
}

type EventFieldMapping = EventMapping["field_mappings"][number]
type CommandFieldMapping = CommandMapping["field_mappings"][number]

function displayName(item: { label?: string; key?: string }, fallback: string): string {
  return item.label || item.key || fallback
}

function profileDocument(resource: DeviceProfileResource): DeviceProfileDocument | null {
  if (!resource.version) return null
  return {
    schema: resource.schema,
    profile: resource.profile,
    version: resource.version,
  }
}

function ReferenceSelect({
  id,
  label,
  value,
  options,
  onChange,
  description,
}: {
  id: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  description?: string
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value || undefined} onValueChange={onChange} disabled={editorReadOnly}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function EmptyMapping({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CableIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <p className="text-sm text-muted-foreground">Use “Synchronize mappings” to add the Profile targets.</p>
      </EmptyContent>
    </Empty>
  )
}

export function BindingEditor({
  profiles,
  bindings,
  draft,
  selectedUuid,
  selectedResource,
  error,
  saving,
  onDraftChange,
  onSelect,
  onNew,
  onSave,
  onDelete,
}: BindingEditorProps) {
  const [newProfileUuid, setNewProfileUuid] = useState(profiles[0]?.profile.uuid ?? "")
  const [catalogBindingUuid, setCatalogBindingUuid] = useState(bindings[0]?.binding.uuid ?? "")
  const readOnly = selectedResource?.meta.state === "published"
  const profileResource = draft
    ? profiles.find((profile) => profile.profile.uuid === draft.binding.profile_uuid) ?? null
    : null
  const profile = profileResource ? profileDocument(profileResource) : null

  useEffect(() => {
    if (!newProfileUuid && profiles[0]) setNewProfileUuid(profiles[0].profile.uuid)
  }, [newProfileUuid, profiles])

  useEffect(() => {
    if (!catalogBindingUuid && bindings[0]) setCatalogBindingUuid(bindings[0].binding.uuid)
  }, [bindings, catalogBindingUuid])

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open or create a Native MQTT Binding</CardTitle>
          <CardDescription>
            Open a saved Binding, or select a Profile to map its stable semantic UUIDs to MQTT topics and JSON paths.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {bindings.length > 0 ? (
            <Field className="max-w-xl">
              <FieldLabel htmlFor="open-binding-catalog">Saved Binding</FieldLabel>
              <Select value={catalogBindingUuid} onValueChange={setCatalogBindingUuid}>
                <SelectTrigger id="open-binding-catalog" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {bindings.map((item) => (
                      <SelectItem key={item.binding.uuid} value={item.binding.uuid}>
                        {item.binding.name} · {item.meta.state}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {profiles.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RadioTowerIcon />
                </EmptyMedia>
                <EmptyTitle>No saved Profile</EmptyTitle>
                <EmptyDescription>Create and save a Profile before authoring its transport Binding.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Field className="max-w-xl">
              <FieldLabel htmlFor="new-binding-profile">Device Profile</FieldLabel>
              <Select value={newProfileUuid} onValueChange={setNewProfileUuid}>
                <SelectTrigger id="new-binding-profile" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {profiles.map((item) => (
                      <SelectItem key={item.profile.uuid} value={item.profile.uuid}>
                        {item.profile.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </CardContent>
        {profiles.length > 0 || bindings.length > 0 ? (
          <CardFooter className="flex flex-wrap gap-2">
            {bindings.length > 0 ? (
              <Button type="button" variant="outline" onClick={() => onSelect(catalogBindingUuid)}>
                <CableIcon data-icon="inline-start" />
                Open saved Binding
              </Button>
            ) : null}
            {profiles.length > 0 ? (
            <Button
              type="button"
              onClick={() => {
                const selected = profiles.find((item) => item.profile.uuid === newProfileUuid)
                const document = selected ? profileDocument(selected) : null
                if (document) onNew(document)
              }}
            >
              <PlusIcon data-icon="inline-start" />
              Create Binding draft
            </Button>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    )
  }

  const currentDraft = draft

  function changeVersion(next: Partial<NativeMqttBindingDocument["version"]>) {
    onDraftChange({ ...currentDraft, version: { ...currentDraft.version, ...next } })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave(currentDraft)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Native MQTT Binding</CardTitle>
          <CardDescription>
            Map one semantic Profile Version to MQTT JSON. Labels, units, and UI metadata stay out of wire payloads.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end">
          <Field className="flex-1">
            <FieldLabel htmlFor="binding-catalog">Saved Binding</FieldLabel>
            <Select value={selectedUuid ?? undefined} onValueChange={onSelect}>
              <SelectTrigger id="binding-catalog" className="w-full">
                <SelectValue placeholder="Select a saved Binding" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {bindings.map((binding) => (
                    <SelectItem key={binding.binding.uuid} value={binding.binding.uuid}>
                      {binding.binding.name} · v{binding.version?.version ?? 1}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <ReferenceSelect
            id="binding-profile-context"
            label="Mapped Profile"
            value={draft.binding.profile_uuid}
            options={profiles.map((item) => ({ value: item.profile.uuid, label: item.profile.name }))}
            onChange={(uuid) => {
              const resource = profiles.find((item) => item.profile.uuid === uuid)
              const document = resource ? profileDocument(resource) : null
              if (!document) return
              onDraftChange(
                synchronizeBinding(
                  {
                    ...draft,
                    binding: { ...draft.binding, profile_uuid: uuid },
                    version: { ...draft.version, profile_version_uuid: document.version.uuid },
                  },
                  document,
                ),
              )
            }}
          />
          <Button type="button" variant="outline" onClick={() => profile && onDraftChange(synchronizeBinding(draft, profile))}>
            <ListRestartIcon data-icon="inline-start" />
            Synchronize mappings
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const resource = profiles.find((item) => item.profile.uuid === newProfileUuid) ?? profiles[0]
              const document = resource ? profileDocument(resource) : null
              if (document) onNew(document)
            }}
          >
            <PlusIcon data-icon="inline-start" />
            New Binding
          </Button>
          {selectedResource?.meta.state === "draft" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline">
                  <Trash2Icon data-icon="inline-start" />
                  Delete draft
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this Binding draft?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The API refuses deletion after the Binding is referenced by a Device assignment.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep draft</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void onDelete()}>
                    Delete draft
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </CardContent>
      </Card>

      {readOnly ? (
        <Alert>
          <RadioTowerIcon />
          <AlertTitle>Published Binding is immutable</AlertTitle>
          <AlertDescription>
            Its exact channels, mappings, policies, and transformations are pinned in the generated artifact.
          </AlertDescription>
        </Alert>
      ) : null}
      {!profile ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Mapped Profile is unavailable</AlertTitle>
          <AlertDescription>Select an accessible saved Profile before editing mappings.</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Binding could not be saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={(event) => void submit(event)}>
        <EditorReadOnlyProvider value={readOnly || saving}>
          <div className="flex flex-col gap-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    Binding identity
                    <Badge variant={readOnly ? "secondary" : "outline"}>
                      {selectedResource?.meta.state ?? "new draft"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    The Binding targets Profile Version {profile?.version.version ?? "—"}; stable UUID mappings survive every edit.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <FieldGroup className="grid gap-4 md:grid-cols-2">
                    <TextField
                      id="binding-name"
                      label="Binding name"
                      value={draft.binding.name}
                      required
                      placeholder="North hub three-phase mapping"
                      onChange={(name) =>
                        onDraftChange({
                          ...draft,
                          binding: {
                            ...draft.binding,
                            name,
                            key: draft.binding.key || slugKey(name),
                          },
                        })
                      }
                    />
                    <TextField
                      id="binding-key"
                      label="Binding key"
                      value={draft.binding.key}
                      required
                      onChange={(key) =>
                        onDraftChange({
                          ...draft,
                          binding: { ...draft.binding, key: slugKey(key) },
                        })
                      }
                    />
                    <NumberField
                      id="binding-version"
                      label="Version"
                      value={draft.version.version}
                      min={1}
                      step={1}
                      onChange={(version) => changeVersion({ version: version ?? 1 })}
                    />
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="binding-description">Description</FieldLabel>
                      <Textarea
                        id="binding-description"
                        value={draft.binding.description ?? ""}
                        disabled={readOnly || saving}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            binding: {
                              ...draft.binding,
                              description: event.target.value || null,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="binding-notes">Version notes</FieldLabel>
                      <Textarea
                        id="binding-notes"
                        value={draft.version.notes ?? ""}
                        disabled={readOnly || saving}
                        onChange={(event) => changeVersion({ notes: event.target.value || null })}
                      />
                    </Field>
                  </FieldGroup>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <StableId value={draft.binding.uuid} />
                    <StableId value={draft.version.uuid} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Transport contract</CardTitle>
                  <CardDescription>
                    Channels define topics. Mappings define extraction, calibration, invalid-data policy, and Command encoding.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="channels">
                    <TabsList className="h-auto w-full flex-wrap justify-start">
                      <TabsTrigger value="channels">Channels ({draft.version.channels.length})</TabsTrigger>
                      <TabsTrigger value="parameters">Parameters ({draft.version.parameter_mappings.length})</TabsTrigger>
                      <TabsTrigger value="properties">Properties ({draft.version.property_mappings.length})</TabsTrigger>
                      <TabsTrigger value="events">Events ({draft.version.event_mappings.length})</TabsTrigger>
                      <TabsTrigger value="commands">Commands ({draft.version.command_mappings.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="channels" className="flex flex-col gap-4 pt-4">
                      <SectionHeader
                        title="MQTT channels"
                        description="The Gateway publishes or subscribes to these resolved topics."
                        action={
                          <AddButton
                            onClick={() =>
                              changeVersion({ channels: [...draft.version.channels, createChannel(`channel_${draft.version.channels.length + 1}`)] })
                            }
                          >
                            Add channel
                          </AddButton>
                        }
                      />
                      <Accordion type="multiple" className="rounded-lg border px-4">
                        {draft.version.channels.map((channel, index) => (
                          <AccordionItem key={channel.uuid} value={channel.uuid}>
                            <AccordionTrigger>{displayName(channel, `Channel ${index + 1}`)}</AccordionTrigger>
                            <AccordionContent>
                              <ChannelEditor
                                channel={channel}
                                index={index}
                                count={draft.version.channels.length}
                                onChange={(next) =>
                                  changeVersion({ channels: replaceItem(draft.version.channels, next) })
                                }
                                onMove={(direction) =>
                                  changeVersion({ channels: moveItem(draft.version.channels, index, direction) })
                                }
                                onRemove={() =>
                                  changeVersion({
                                    channels: draft.version.channels.filter((item) => item.uuid !== channel.uuid),
                                  })
                                }
                              />
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </TabsContent>

                    <TabsContent value="parameters" className="flex flex-col gap-4 pt-4">
                      <SectionHeader
                        title="Measured parameter mappings"
                        description="Map each Profile parameter UUID to one channel and JSONPath."
                      />
                      {draft.version.parameter_mappings.length === 0 ? (
                        <EmptyMapping title="No parameter mappings" description="Every measured Profile parameter requires exactly one mapping." />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.parameter_mappings.map((mapping, index) => {
                            const parameter = profile?.version.parameters.find((item) => item.uuid === mapping.target_parameter_uuid)
                            return (
                              <AccordionItem key={mapping.uuid} value={mapping.uuid}>
                                <AccordionTrigger>{displayName(parameter ?? {}, `Mapping ${index + 1}`)}</AccordionTrigger>
                                <AccordionContent>
                                  <ParameterMappingEditor
                                    mapping={mapping}
                                    index={index}
                                    count={draft.version.parameter_mappings.length}
                                    channels={draft.version.channels}
                                    targets={profile?.version.parameters ?? []}
                                    onChange={(next) =>
                                      changeVersion({
                                        parameter_mappings: replaceItem(draft.version.parameter_mappings, next),
                                      })
                                    }
                                    onMove={(direction) =>
                                      changeVersion({
                                        parameter_mappings: moveItem(draft.version.parameter_mappings, index, direction),
                                      })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        parameter_mappings: draft.version.parameter_mappings.filter(
                                          (item) => item.uuid !== mapping.uuid,
                                        ),
                                      })
                                    }
                                  />
                                </AccordionContent>
                              </AccordionItem>
                            )
                          })}
                        </Accordion>
                      )}
                    </TabsContent>

                    <TabsContent value="properties" className="flex flex-col gap-4 pt-4">
                      <SectionHeader
                        title="Property mappings"
                        description="Platform-only properties do not receive a transport mapping. Desired and reported properties do."
                      />
                      {draft.version.property_mappings.length === 0 ? (
                        <EmptyMapping title="No property mappings" description="Add desired or reported Profile properties, then synchronize." />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.property_mappings.map((mapping, index) => {
                            const property = profile?.version.properties.find((item) => item.uuid === mapping.target_property_uuid)
                            return (
                              <AccordionItem key={mapping.uuid} value={mapping.uuid}>
                                <AccordionTrigger>{displayName(property ?? {}, `Mapping ${index + 1}`)}</AccordionTrigger>
                                <AccordionContent>
                                  <PropertyMappingEditor
                                    mapping={mapping}
                                    index={index}
                                    count={draft.version.property_mappings.length}
                                    channels={draft.version.channels}
                                    targets={profile?.version.properties.filter((item) => item.scope !== "platform") ?? []}
                                    onChange={(next) =>
                                      changeVersion({ property_mappings: replaceItem(draft.version.property_mappings, next) })
                                    }
                                    onMove={(direction) =>
                                      changeVersion({ property_mappings: moveItem(draft.version.property_mappings, index, direction) })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        property_mappings: draft.version.property_mappings.filter(
                                          (item) => item.uuid !== mapping.uuid,
                                        ),
                                      })
                                    }
                                  />
                                </AccordionContent>
                              </AccordionItem>
                            )
                          })}
                        </Accordion>
                      )}
                    </TabsContent>

                    <TabsContent value="events" className="flex flex-col gap-4 pt-4">
                      <SectionHeader title="Event mappings" description="Extract event identity, state, and typed event fields from inbound channels." />
                      {draft.version.event_mappings.length === 0 ? (
                        <EmptyMapping title="No event mappings" description="Add Profile events, then synchronize." />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.event_mappings.map((mapping, index) => {
                            const event = profile?.version.events.find((item) => item.uuid === mapping.target_event_uuid)
                            return (
                              <AccordionItem key={mapping.uuid} value={mapping.uuid}>
                                <AccordionTrigger>{displayName(event ?? {}, `Event mapping ${index + 1}`)}</AccordionTrigger>
                                <AccordionContent>
                                  <EventMappingEditor
                                    mapping={mapping}
                                    event={event}
                                    index={index}
                                    count={draft.version.event_mappings.length}
                                    channels={draft.version.channels}
                                    onChange={(next) =>
                                      changeVersion({ event_mappings: replaceItem(draft.version.event_mappings, next) })
                                    }
                                    onMove={(direction) =>
                                      changeVersion({ event_mappings: moveItem(draft.version.event_mappings, index, direction) })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        event_mappings: draft.version.event_mappings.filter((item) => item.uuid !== mapping.uuid),
                                      })
                                    }
                                  />
                                </AccordionContent>
                              </AccordionItem>
                            )
                          })}
                        </Accordion>
                      )}
                    </TabsContent>

                    <TabsContent value="commands" className="flex flex-col gap-4 pt-4">
                      <SectionHeader
                        title="Command mappings"
                        description="Define request and response topics, minimal payload placement, correlation, and terminal status extraction."
                      />
                      {draft.version.command_mappings.length === 0 ? (
                        <EmptyMapping title="No Command mappings" description="Add Profile Commands, then synchronize." />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.command_mappings.map((mapping, index) => {
                            const command = profile?.version.commands.find((item) => item.uuid === mapping.target_command_uuid)
                            return (
                              <AccordionItem key={mapping.uuid} value={mapping.uuid}>
                                <AccordionTrigger>{displayName(command ?? {}, `Command mapping ${index + 1}`)}</AccordionTrigger>
                                <AccordionContent>
                                  <CommandMappingEditor
                                    mapping={mapping}
                                    command={command}
                                    index={index}
                                    count={draft.version.command_mappings.length}
                                    channels={draft.version.channels}
                                    onChange={(next) =>
                                      changeVersion({ command_mappings: replaceItem(draft.version.command_mappings, next) })
                                    }
                                    onMove={(direction) =>
                                      changeVersion({ command_mappings: moveItem(draft.version.command_mappings, index, direction) })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        command_mappings: draft.version.command_mappings.filter((item) => item.uuid !== mapping.uuid),
                                      })
                                    }
                                  />
                                </AccordionContent>
                              </AccordionItem>
                            )
                          })}
                        </Accordion>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>

            <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
              <JsonPreview
                title="Canonical Binding JSON"
                description="Read-only synchronized transport contract. Commands contain only routing, correlation, and values."
                value={draft}
                testId="binding-json-preview"
              />
            </div>
          </div>

          {!readOnly ? (
            <Card>
              <CardFooter className="justify-end pt-6">
                <Button type="submit" disabled={saving || !profile}>
                  {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
                  {saving ? "Saving Binding…" : selectedUuid ? "Save Binding draft" : "Create Binding draft"}
                </Button>
              </CardFooter>
            </Card>
          ) : null}
          </div>
        </EditorReadOnlyProvider>
      </form>
    </div>
  )
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

function ChannelEditor({
  channel,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  channel: BindingChannel
  index: number
  count: number
  onChange: (channel: BindingChannel) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const observedAt = channel.envelope.observed_at
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StableId value={channel.uuid} />
        <RepeaterActions label={displayName(channel, `channel ${index + 1}`)} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
      <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TextField
          id={`${channel.uuid}-label`}
          label="Channel label"
          value={channel.label}
          required
          onChange={(label) => onChange({ ...channel, label, key: channel.key || slugKey(label) })}
        />
        <TextField
          id={`${channel.uuid}-key`}
          label="Channel key"
          value={channel.key}
          required
          onChange={(key) => onChange({ ...channel, key: slugKey(key) })}
        />
        <SelectField
          id={`${channel.uuid}-purpose`}
          label="Purpose"
          value={channel.purpose}
          options={["telemetry", "reported_properties", "desired_properties", "event", "command_request", "command_response"] as const}
          onChange={(purpose) => onChange({ ...channel, purpose })}
        />
        <SelectField
          id={`${channel.uuid}-direction`}
          label="Direction"
          value={channel.direction}
          options={["device_to_platform", "platform_to_device"] as const}
          onChange={(direction) => onChange({ ...channel, direction })}
        />
        <SelectField
          id={`${channel.uuid}-qos`}
          label="QoS"
          value={String(channel.qos) as "0" | "1"}
          options={["0", "1"] as const}
          onChange={(qos) => onChange({ ...channel, qos: Number(qos) as 0 | 1 })}
        />
        <BooleanField id={`${channel.uuid}-retain`} label="Retained MQTT message" checked={channel.retain} onChange={(retain) => onChange({ ...channel, retain })} />
        <TextField
          id={`${channel.uuid}-topic`}
          label="Topic template"
          value={channel.topic_template}
          required
          placeholder="gateways/{gateway_id}/devices/{route_path}/telemetry"
          onChange={(topic_template) => onChange({ ...channel, topic_template })}
        />
      <TextField id={`${channel.uuid}-record-path`} label="Record path" value={channel.record_path} placeholder="$" onChange={(record_path) => onChange({ ...channel, record_path: record_path || "$" })} />
        <NumberField id={`${channel.uuid}-max-records`} label="Maximum records" value={channel.max_records} min={1} max={100} step={1} onChange={(max_records) => onChange({ ...channel, max_records: max_records ?? 1 })} />
        <TextField
          id={`${channel.uuid}-observed-path`}
          label="Observed-at JSONPath"
          value={observedAt?.path.json_path ?? ""}
          placeholder="$.timestamp"
          onChange={(json_path) =>
            onChange({
              ...channel,
              envelope: {
                ...channel.envelope,
                ...(json_path
                  ? {
                      observed_at: {
                        path: { scope: observedAt?.path.scope ?? "message", json_path },
                        format: observedAt?.format ?? "rfc3339",
                      },
                    }
                  : { observed_at: undefined }),
              },
            })
          }
        />
        {observedAt ? (
          <SelectField
            id={`${channel.uuid}-timestamp-format`}
            label="Timestamp format"
            value={observedAt.format}
            options={["rfc3339", "unix_seconds", "unix_milliseconds"] as const}
            onChange={(format) => onChange({ ...channel, envelope: { ...channel.envelope, observed_at: { ...observedAt, format } } })}
          />
        ) : null}
        <TextField
          id={`${channel.uuid}-message-id`}
          label="Message ID JSONPath"
          value={channel.envelope.message_id?.json_path ?? ""}
          placeholder="$.message_id"
          onChange={(json_path) =>
            onChange({
              ...channel,
              envelope: {
                ...channel.envelope,
                ...(json_path
                  ? { message_id: { scope: channel.envelope.message_id?.scope ?? "message", json_path } }
                  : { message_id: undefined }),
              },
            })
          }
        />
      </FieldGroup>
    </div>
  )
}

function MappingPolicyEditor<T extends { on_missing: ParameterMapping["on_missing"]; on_invalid: ParameterMapping["on_invalid"]; default_value?: unknown }>({
  id,
  value,
  onChange,
}: {
  id: string
  value: T
  onChange: (value: T) => void
}) {
  const usesDefault = value.on_missing === "use_default" || value.on_invalid === "use_default"
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <SelectField id={`${id}-missing`} label="When missing" value={value.on_missing} options={missingPolicies} onChange={(on_missing) => onChange({ ...value, on_missing })} />
      <SelectField id={`${id}-invalid`} label="When invalid" value={value.on_invalid} options={invalidPolicies} onChange={(on_invalid) => onChange({ ...value, on_invalid })} />
      {usesDefault ? (
        <TextField
          id={`${id}-default`}
          label="Default JSON value"
          value={value.default_value === undefined ? "" : JSON.stringify(value.default_value)}
          placeholder={'0 or false or "unknown"'}
          onChange={(text) => {
            try {
              onChange({ ...value, default_value: JSON.parse(text) })
            } catch {
              // Keep the last valid JSON scalar while the user is typing.
            }
          }}
        />
      ) : null}
    </FieldGroup>
  )
}

function MappingSourceFields<T extends { channel: string; source: { scope: "message" | "record" | "route"; json_path: string }; wire_data_type: ParameterMapping["wire_data_type"] }>({
  id,
  value,
  channels,
  onChange,
}: {
  id: string
  value: T
  channels: BindingChannel[]
  onChange: (value: T) => void
}) {
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <ReferenceSelect id={`${id}-channel`} label="Channel" value={value.channel} options={channels.map((item) => ({ value: item.key, label: item.label }))} onChange={(channel) => onChange({ ...value, channel })} />
      <SelectField id={`${id}-scope`} label="JSONPath scope" value={value.source.scope} options={["message", "record", "route"] as const} onChange={(scope) => onChange({ ...value, source: { ...value.source, scope } })} />
      <TextField id={`${id}-path`} label="Source JSONPath" value={value.source.json_path} required placeholder="$.temperature" onChange={(json_path) => onChange({ ...value, source: { ...value.source, json_path } })} />
      <SelectField id={`${id}-wire-type`} label="Wire data type" value={value.wire_data_type} options={dataTypes} onChange={(wire_data_type) => onChange({ ...value, wire_data_type })} />
    </FieldGroup>
  )
}

function ParameterMappingEditor({
  mapping,
  index,
  count,
  channels,
  targets,
  onChange,
  onMove,
  onRemove,
}: {
  mapping: ParameterMapping
  index: number
  count: number
  channels: BindingChannel[]
  targets: DeviceProfileDocument["version"]["parameters"]
  onChange: (mapping: ParameterMapping) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const target = targets.find((item) => item.uuid === mapping.target_parameter_uuid)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StableId value={mapping.uuid} />
        <RepeaterActions label={displayName(target ?? {}, `mapping ${index + 1}`)} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
      <ReferenceSelect
        id={`${mapping.uuid}-target`}
        label="Target parameter"
        value={mapping.target_parameter_uuid}
        options={targets.map((item) => ({ value: item.uuid, label: `${item.label} · ${item.uuid.slice(0, 8)}` }))}
        description="The stable Profile UUID, not the display label, owns time-series identity."
        onChange={(target_parameter_uuid) => {
          const nextTarget = targets.find((item) => item.uuid === target_parameter_uuid)
          onChange({ ...mapping, target_parameter_uuid, wire_data_type: nextTarget?.value_schema.data_type ?? mapping.wire_data_type })
        }}
      />
      <MappingSourceFields id={mapping.uuid} value={mapping} channels={channels} onChange={onChange} />
      <MappingPolicyEditor id={mapping.uuid} value={mapping} onChange={onChange} />
      <CalibrationEditor id={`${mapping.uuid}-calibration`} value={mapping.calibration} onChange={(calibration) => onChange({ ...mapping, calibration })} />
    </div>
  )
}

function PropertyMappingEditor({
  mapping,
  index,
  count,
  channels,
  targets,
  onChange,
  onMove,
  onRemove,
}: {
  mapping: PropertyMapping
  index: number
  count: number
  channels: BindingChannel[]
  targets: ProfileProperty[]
  onChange: (mapping: PropertyMapping) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const target = targets.find((item) => item.uuid === mapping.target_property_uuid)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StableId value={mapping.uuid} />
        <RepeaterActions label={displayName(target ?? {}, `mapping ${index + 1}`)} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
      <ReferenceSelect id={`${mapping.uuid}-target`} label="Target property" value={mapping.target_property_uuid} options={targets.map((item) => ({ value: item.uuid, label: item.label }))} onChange={(target_property_uuid) => onChange({ ...mapping, target_property_uuid })} />
      <SelectField id={`${mapping.uuid}-direction`} label="Direction" value={mapping.direction} options={["device_to_platform", "platform_to_device"] as const} onChange={(direction) => onChange({ ...mapping, direction })} />
      <MappingSourceFields id={mapping.uuid} value={mapping} channels={channels} onChange={onChange} />
      <MappingPolicyEditor id={mapping.uuid} value={mapping} onChange={onChange} />
      <CalibrationEditor id={`${mapping.uuid}-operations`} title="Transformation pipeline" value={mapping.operations} onChange={(operations) => onChange({ ...mapping, operations })} />
    </div>
  )
}

function EventMappingEditor({
  mapping,
  event,
  index,
  count,
  channels,
  onChange,
  onMove,
  onRemove,
}: {
  mapping: EventMapping
  event?: ProfileEvent
  index: number
  count: number
  channels: BindingChannel[]
  onChange: (mapping: EventMapping) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StableId value={mapping.uuid} />
        <RepeaterActions label={displayName(event ?? {}, `event mapping ${index + 1}`)} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
      <ReferenceSelect id={`${mapping.uuid}-channel`} label="Inbound event channel" value={mapping.channel} options={channels.filter((item) => item.direction === "device_to_platform").map((item) => ({ value: item.key, label: item.label }))} onChange={(channel) => onChange({ ...mapping, channel })} />
      <TextField
        id={`${mapping.uuid}-event-id`}
        label="Event ID JSONPath"
        value={mapping.event_id?.json_path ?? ""}
        placeholder="$.event_id"
        onChange={(json_path) => onChange({ ...mapping, ...(json_path ? { event_id: { scope: mapping.event_id?.scope ?? "route", json_path } } : { event_id: undefined }) })}
      />
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm font-medium">Event field mappings</p>
        {mapping.field_mappings.map((fieldMapping, fieldIndex) => {
          const target = event?.fields.find((field) => field.uuid === fieldMapping.target_event_field_uuid)
          return (
            <Card key={fieldMapping.target_event_field_uuid}>
              <CardHeader>
                <CardTitle className="text-base">{displayName(target ?? {}, `Field ${fieldIndex + 1}`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <EventFieldMappingEditor
                  id={`${mapping.uuid}-${fieldIndex}`}
                  value={fieldMapping}
                  onChange={(next) =>
                    onChange({
                      ...mapping,
                      field_mappings: mapping.field_mappings.map((item, itemIndex) =>
                        itemIndex === fieldIndex ? next : item,
                      ),
                    })
                  }
                />
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function EventFieldMappingEditor({ id, value, onChange }: { id: string; value: EventFieldMapping; onChange: (value: EventFieldMapping) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <FieldGroup className="grid gap-4 md:grid-cols-3">
        <SelectField id={`${id}-scope`} label="Scope" value={value.source.scope} options={["message", "record", "route"] as const} onChange={(scope) => onChange({ ...value, source: { ...value.source, scope } })} />
        <TextField id={`${id}-path`} label="Source JSONPath" value={value.source.json_path} onChange={(json_path) => onChange({ ...value, source: { ...value.source, json_path } })} />
        <SelectField id={`${id}-wire`} label="Wire data type" value={value.wire_data_type} options={dataTypes} onChange={(wire_data_type) => onChange({ ...value, wire_data_type })} />
      </FieldGroup>
      <MappingPolicyEditor id={id} value={value} onChange={onChange} />
      <CalibrationEditor id={`${id}-operations`} title="Field transformation" value={value.operations} onChange={(operations) => onChange({ ...value, operations })} />
    </div>
  )
}

function CommandMappingEditor({
  mapping,
  command,
  index,
  count,
  channels,
  onChange,
  onMove,
  onRemove,
}: {
  mapping: CommandMapping
  command?: ProfileCommand
  index: number
  count: number
  channels: BindingChannel[]
  onChange: (mapping: CommandMapping) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StableId value={mapping.uuid} />
        <RepeaterActions label={displayName(command ?? {}, `Command mapping ${index + 1}`)} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <ReferenceSelect id={`${mapping.uuid}-request-channel`} label="Request channel" value={mapping.request_channel} options={channels.filter((item) => item.purpose === "command_request").map((item) => ({ value: item.key, label: item.label }))} onChange={(request_channel) => onChange({ ...mapping, request_channel })} />
        {command?.mode === "two_way" ? (
          <ReferenceSelect id={`${mapping.uuid}-response-channel`} label="Response channel" value={mapping.response_channel ?? ""} options={channels.filter((item) => item.purpose === "command_response").map((item) => ({ value: item.key, label: item.label }))} onChange={(response_channel) => onChange({ ...mapping, response_channel })} />
        ) : null}
        <TextField id={`${mapping.uuid}-command-id`} label="Command ID placement" value={mapping.request_envelope.command_id_path} required onChange={(command_id_path) => onChange({ ...mapping, request_envelope: { ...mapping.request_envelope, command_id_path } })} />
        <TextField id={`${mapping.uuid}-requested-at`} label="Requested-at placement" value={mapping.request_envelope.requested_at_path ?? ""} onChange={(requested_at_path) => onChange({ ...mapping, request_envelope: { ...mapping.request_envelope, requested_at_path: requested_at_path || undefined } })} />
        <TextField id={`${mapping.uuid}-route-path`} label="Route path placement" value={mapping.request_envelope.route_path_path ?? ""} onChange={(route_path_path) => onChange({ ...mapping, request_envelope: { ...mapping.request_envelope, route_path_path: route_path_path || undefined } })} />
        {mapping.response ? (
          <>
            <TextField id={`${mapping.uuid}-correlation`} label="Response correlation JSONPath" value={mapping.response.correlation.json_path} onChange={(json_path) => onChange({ ...mapping, response: { ...mapping.response!, correlation: { ...mapping.response!.correlation, json_path } } })} />
            <TextField id={`${mapping.uuid}-status-path`} label="Response status JSONPath" value={mapping.response.status.path.json_path} onChange={(json_path) => onChange({ ...mapping, response: { ...mapping.response!, status: { ...mapping.response!.status, path: { ...mapping.response!.status.path, json_path } } } })} />
          </>
        ) : null}
      </FieldGroup>
      <JsonObjectEditor value={mapping.request_template} onChange={(request_template) => onChange({ ...mapping, request_template })} />
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm font-medium">Command field mappings</p>
        {mapping.field_mappings.map((fieldMapping, fieldIndex) => {
          const target = command?.fields.find((field) => field.uuid === fieldMapping.target_command_field_uuid)
          return (
            <Card key={`${fieldMapping.target_command_field_uuid}-${fieldMapping.direction}`}>
              <CardHeader>
                <CardTitle className="text-base">{displayName(target ?? {}, `Field ${fieldIndex + 1}`)}</CardTitle>
                <CardDescription>{fieldMapping.direction} · values only</CardDescription>
              </CardHeader>
              <CardContent>
                <CommandFieldMappingEditor
                  id={`${mapping.uuid}-${fieldIndex}`}
                  value={fieldMapping}
                  onChange={(next) =>
                    onChange({
                      ...mapping,
                      field_mappings: mapping.field_mappings.map((item, itemIndex) =>
                        itemIndex === fieldIndex ? next : item,
                      ),
                    })
                  }
                />
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function CommandFieldMappingEditor({ id, value, onChange }: { id: string; value: CommandFieldMapping; onChange: (value: CommandFieldMapping) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <FieldGroup className="grid gap-4 md:grid-cols-3">
        <TextField id={`${id}-path`} label="Payload JSONPath" value={value.json_path} required onChange={(json_path) => onChange({ ...value, json_path })} />
        <SelectField id={`${id}-wire`} label="Wire data type" value={value.wire_data_type} options={dataTypes} onChange={(wire_data_type) => onChange({ ...value, wire_data_type })} />
        <SelectField id={`${id}-direction`} label="Direction" value={value.direction} options={["input", "output"] as const} onChange={(direction) => onChange({ ...value, direction })} />
      </FieldGroup>
      <MappingPolicyEditor id={id} value={value} onChange={onChange} />
      <CalibrationEditor id={`${id}-operations`} title="Field transformation" value={value.operations} onChange={(operations: CalibrationOperation[]) => onChange({ ...value, operations })} />
    </div>
  )
}

function JsonObjectEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState<string | null>(null)
  const editorReadOnly = useEditorReadOnly()

  useEffect(() => setText(JSON.stringify(value, null, 2)), [value])

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor="command-request-template">Static request template</FieldLabel>
      <Textarea
        id="command-request-template"
        className="font-mono text-xs"
        rows={5}
        value={text}
        disabled={editorReadOnly}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          try {
            const parsed = JSON.parse(next)
            if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Template must be a JSON object.")
            setError(null)
            onChange(parsed as Record<string, unknown>)
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Invalid JSON")
          }
        }}
      />
      <FieldDescription>
        {error ?? "Only static envelope values belong here. Dynamic Command field values are placed by UUID mappings."}
      </FieldDescription>
    </Field>
  )
}
