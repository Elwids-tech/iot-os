import type { FormEvent } from "react"
import type { DeviceProfileDocument, DeviceProfileResource } from "@iot-os/api-client"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@iot-os/ui/components/accordion"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@iot-os/ui/components/alert-dialog"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@iot-os/ui/components/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@iot-os/ui/components/select"
import { Spinner } from "@iot-os/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { Textarea } from "@iot-os/ui/components/textarea"
import { ActivityIcon, AlertTriangleIcon, BracesIcon, BoxesIcon, CalculatorIcon, CopyIcon, GaugeIcon, PlusIcon, SaveIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react"
import {
  AddButton,
  BooleanField,
  EditorReadOnlyProvider,
  JsonPreview,
  NumberField,
  RepeaterActions,
  SelectField,
  StableId,
  TextField,
  useEditorReadOnly,
  ValueSchemaEditor,
} from "./EditorPrimitives"
import {
  createCommand,
  createCommandField,
  createDerivedParameter,
  createEvent,
  createEventField,
  createParameter,
  createProperty,
  moveItem,
  replaceItem,
  slugKey,
  type CommandField,
  type DerivedParameter,
  type EventField,
  type ProfileCommand,
  type ProfileEvent,
  type ProfileParameter,
  type ProfileProperty,
} from "./model"

type ProfileEditorProps = {
  profiles: DeviceProfileResource[]
  draft: DeviceProfileDocument
  selectedUuid: string | null
  selectedResource: DeviceProfileResource | null
  error: string | null
  saving: boolean
  onDraftChange: (draft: DeviceProfileDocument) => void
  onSelect: (uuid: string) => void
  onNew: () => void
  onSave: (draft: DeviceProfileDocument) => Promise<void>
  onClone: () => Promise<void>
  onDelete: () => Promise<void>
}

type ParameterLike =
  | ProfileParameter
  | DerivedParameter
  | ProfileProperty
  | EventField
  | CommandField

function nextOrder(items: Array<{ presentation?: { order: number } }>): number {
  return Math.max(0, ...items.map((item) => item.presentation?.order ?? 0)) + 10
}

function itemName(item: { label: string; key: string }, fallback: string): string {
  return item.label || item.key || fallback
}

function ParameterFields({
  id,
  value,
  onChange,
}: {
  id: string
  value: ParameterLike
  onChange: (value: ParameterLike) => void
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <div className="flex flex-col gap-5">
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <TextField
          id={`${id}-label`}
          label="Label"
          value={value.label}
          required
          placeholder="Temperature"
          onChange={(label) =>
            onChange({ ...value, label, key: value.key || slugKey(label) } as ParameterLike)
          }
        />
        <TextField
          id={`${id}-key`}
          label="Parameter key"
          value={value.key}
          required
          placeholder="temperature"
          description="Stable machine-readable key. Time-series identity uses the UUID below."
          onChange={(key) => onChange({ ...value, key: slugKey(key) } as ParameterLike)}
        />
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
          <Textarea
            id={`${id}-description`}
            value={value.description ?? ""}
            disabled={editorReadOnly}
            onChange={(event) =>
              onChange({ ...value, description: event.target.value || null } as ParameterLike)
            }
          />
        </Field>
      </FieldGroup>
      <ValueSchemaEditor
        id={`${id}-schema`}
        value={value.value_schema}
        presentation={value.presentation}
        onChange={(value_schema, presentation) =>
          onChange({ ...value, value_schema, presentation } as ParameterLike)
        }
      />
    </div>
  )
}

function EmptyRepeater({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof GaugeIcon
  title: string
  description: string
  action: React.ReactNode
}) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  )
}

export function ProfileEditor({
  profiles,
  draft,
  selectedUuid,
  selectedResource,
  error,
  saving,
  onDraftChange,
  onSelect,
  onNew,
  onSave,
  onClone,
  onDelete,
}: ProfileEditorProps) {
  const readOnly = selectedResource?.meta.state === "published"
  const profileOptions = profiles.map((profile) => ({
    value: profile.profile.uuid,
    label: `${profile.profile.name} · v${profile.version?.version ?? 1}`,
  }))

  function changeVersion(next: Partial<DeviceProfileDocument["version"]>) {
    onDraftChange({ ...draft, version: { ...draft.version, ...next } })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave(draft)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Device Profile</CardTitle>
          <CardDescription>
            Define semantic parameters, derived values, properties, events, and Commands without MQTT details.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end">
          <Field className="flex-1">
            <FieldLabel htmlFor="profile-catalog">Saved profile</FieldLabel>
            <Select value={selectedUuid ?? ""} onValueChange={onSelect}>
              <SelectTrigger id="profile-catalog" className="w-full">
                <SelectValue placeholder="Select a saved profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {profileOptions.map((profile) => (
                    <SelectItem key={profile.value} value={profile.value}>
                      {profile.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button type="button" variant="outline" onClick={onNew}>
            <PlusIcon data-icon="inline-start" />
            New profile
          </Button>
          {selectedResource?.meta.state === "published" ? (
            <Button type="button" variant="outline" disabled={saving} onClick={() => void onClone()}>
              <CopyIcon data-icon="inline-start" />
              Clone compatible version
            </Button>
          ) : null}
          {selectedResource?.meta.state === "draft" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline">
                  <Trash2Icon data-icon="inline-start" />
                  {draft.version.version > 1 ? "Discard cloned draft" : "Delete draft"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {draft.version.version > 1 ? "Discard this cloned Profile draft?" : "Delete this Profile draft?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {draft.version.version > 1
                      ? "The published Profile Version remains available. The API will refuse when this draft Version is referenced."
                      : "The API will refuse deletion when a Binding or Device already references the draft."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep draft</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void onDelete()}>
                    {draft.version.version > 1 ? "Discard cloned draft" : "Delete draft"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </CardContent>
      </Card>

      {readOnly ? (
        <Alert>
          <BoxesIcon />
          <AlertTitle>Published Profile is immutable</AlertTitle>
          <AlertDescription>
            Review its canonical JSON here, or clone a compatible draft that preserves stable parameter UUIDs.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Profile could not be saved</AlertTitle>
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
                    Profile identity
                    <Badge variant={readOnly ? "secondary" : "outline"}>
                      {selectedResource?.meta.state ?? "new draft"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    The Profile UUID and Version UUID are generated once and remain stable through every edit.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <FieldGroup className="grid gap-4 md:grid-cols-2">
                    <TextField
                      id="profile-name"
                      label="Profile name"
                      value={draft.profile.name}
                      required
                      placeholder="Three-phase energy meter"
                      onChange={(name) =>
                        onDraftChange({
                          ...draft,
                          profile: {
                            ...draft.profile,
                            name,
                            key: draft.profile.key || slugKey(name),
                          },
                        })
                      }
                    />
                    <TextField
                      id="profile-key"
                      label="Profile key"
                      value={draft.profile.key}
                      required
                      placeholder="three_phase_energy_meter"
                      onChange={(key) =>
                        onDraftChange({
                          ...draft,
                          profile: { ...draft.profile, key: slugKey(key) },
                        })
                      }
                    />
                    <NumberField
                      id="profile-version"
                      label="Version"
                      value={draft.version.version}
                      min={1}
                      step={1}
                      onChange={(version) => changeVersion({ version: version ?? 1 })}
                    />
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="profile-description">Description</FieldLabel>
                      <Textarea
                        id="profile-description"
                        value={draft.profile.description ?? ""}
                        disabled={readOnly || saving}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            profile: {
                              ...draft.profile,
                              description: event.target.value || null,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="profile-notes">Version notes</FieldLabel>
                      <Textarea
                        id="profile-notes"
                        value={draft.version.notes ?? ""}
                        disabled={readOnly || saving}
                        onChange={(event) => changeVersion({ notes: event.target.value || null })}
                      />
                    </Field>
                  </FieldGroup>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <StableId value={draft.profile.uuid} />
                    <StableId value={draft.version.uuid} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Semantic capabilities</CardTitle>
                  <CardDescription>
                    Keep measured and derived parameters separate. Calibration belongs in the Binding editor.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="parameters">
                    <TabsList className="h-auto w-full flex-wrap justify-start">
                      <TabsTrigger value="parameters">Measured ({draft.version.parameters.length})</TabsTrigger>
                      <TabsTrigger value="derived">Derived ({draft.version.derived_parameters.length})</TabsTrigger>
                      <TabsTrigger value="properties">Properties ({draft.version.properties.length})</TabsTrigger>
                      <TabsTrigger value="events">Events ({draft.version.events.length})</TabsTrigger>
                      <TabsTrigger value="commands">Commands ({draft.version.commands.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="parameters" className="flex flex-col gap-4 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-medium">Measured parameters</h3>
                          <p className="text-sm text-muted-foreground">
                            Each UUID is the durable time-series identity.
                          </p>
                        </div>
                        <AddButton
                          onClick={() =>
                            changeVersion({
                              parameters: [
                                ...draft.version.parameters,
                                createParameter(nextOrder(draft.version.parameters)),
                              ],
                            })
                          }
                        >
                          Add parameter
                        </AddButton>
                      </div>
                      {draft.version.parameters.length === 0 ? (
                        <EmptyRepeater
                          icon={GaugeIcon}
                          title="No measured parameters"
                          description="Add temperature, humidity, voltage, current, power, or any other semantic value."
                          action={
                            <AddButton
                              onClick={() => changeVersion({ parameters: [createParameter(10)] })}
                            >
                              Add first parameter
                            </AddButton>
                          }
                        />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.parameters.map((parameter, index) => (
                            <AccordionItem key={parameter.uuid} value={parameter.uuid}>
                              <AccordionTrigger>
                                {itemName(parameter, `Parameter ${index + 1}`)}
                              </AccordionTrigger>
                              <AccordionContent className="flex flex-col gap-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <StableId value={parameter.uuid} />
                                  <RepeaterActions
                                    label={itemName(parameter, `parameter ${index + 1}`)}
                                    index={index}
                                    count={draft.version.parameters.length}
                                    onMove={(direction) =>
                                      changeVersion({
                                        parameters: moveItem(
                                          draft.version.parameters,
                                          index,
                                          direction,
                                        ),
                                      })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        parameters: draft.version.parameters.filter(
                                          (item) => item.uuid !== parameter.uuid,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                                <ParameterFields
                                  id={`parameter-${parameter.uuid}`}
                                  value={parameter}
                                  onChange={(next) =>
                                    changeVersion({
                                      parameters: replaceItem(
                                        draft.version.parameters,
                                        next as ProfileParameter,
                                      ),
                                    })
                                  }
                                />
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      )}
                    </TabsContent>

                    <TabsContent value="derived" className="flex flex-col gap-4 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-medium">Derived parameters</h3>
                          <p className="text-sm text-muted-foreground">
                            Restricted CEL formulas can only use normalized parameters on this logical Device.
                          </p>
                        </div>
                        <AddButton
                          onClick={() =>
                            changeVersion({
                              derived_parameters: [
                                ...draft.version.derived_parameters,
                                createDerivedParameter(nextOrder(draft.version.derived_parameters)),
                              ],
                            })
                          }
                        >
                          Add derived parameter
                        </AddButton>
                      </div>
                      {draft.version.derived_parameters.length === 0 ? (
                        <EmptyRepeater
                          icon={CalculatorIcon}
                          title="No derived parameters"
                          description="Create averages, totals, rates, efficiency, or other values from normalized inputs."
                          action={
                            <AddButton
                              onClick={() =>
                                changeVersion({ derived_parameters: [createDerivedParameter(10)] })
                              }
                            >
                              Add first derivation
                            </AddButton>
                          }
                        />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.derived_parameters.map((parameter, index) => {
                            const dependencies = [
                              ...draft.version.parameters,
                              ...draft.version.derived_parameters.filter(
                                (candidate) => candidate.uuid !== parameter.uuid,
                              ),
                            ]
                            return (
                              <AccordionItem key={parameter.uuid} value={parameter.uuid}>
                                <AccordionTrigger>
                                  {itemName(parameter, `Derived parameter ${index + 1}`)}
                                </AccordionTrigger>
                                <AccordionContent className="flex flex-col gap-5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <StableId value={parameter.uuid} />
                                    <RepeaterActions
                                      label={itemName(parameter, `derived parameter ${index + 1}`)}
                                      index={index}
                                      count={draft.version.derived_parameters.length}
                                      onMove={(direction) =>
                                        changeVersion({
                                          derived_parameters: moveItem(
                                            draft.version.derived_parameters,
                                            index,
                                            direction,
                                          ),
                                        })
                                      }
                                      onRemove={() =>
                                        changeVersion({
                                          derived_parameters: draft.version.derived_parameters.filter(
                                            (item) => item.uuid !== parameter.uuid,
                                          ),
                                        })
                                      }
                                    />
                                  </div>
                                  <ParameterFields
                                    id={`derived-${parameter.uuid}`}
                                    value={parameter}
                                    onChange={(next) =>
                                      changeVersion({
                                        derived_parameters: replaceItem(
                                          draft.version.derived_parameters,
                                          next as DerivedParameter,
                                        ),
                                      })
                                    }
                                  />
                                  <FieldSet>
                                    <FieldLegend variant="label">Dependencies</FieldLegend>
                                    <FieldDescription>
                                      The compiler uses UUID dependencies to order formulas and reject cycles.
                                    </FieldDescription>
                                    <FieldGroup className="grid gap-2 md:grid-cols-2">
                                      {dependencies.map((dependency) => (
                                        <Field key={dependency.uuid} orientation="horizontal">
                                          <Checkbox
                                            id={`${parameter.uuid}-dependency-${dependency.uuid}`}
                                            checked={parameter.dependencies.includes(dependency.uuid)}
                                            disabled={readOnly || saving}
                                            onCheckedChange={(checked) => {
                                              const nextDependencies = checked
                                                ? [...parameter.dependencies, dependency.uuid]
                                                : parameter.dependencies.filter(
                                                    (uuid) => uuid !== dependency.uuid,
                                                  )
                                              changeVersion({
                                                derived_parameters: replaceItem(
                                                  draft.version.derived_parameters,
                                                  { ...parameter, dependencies: nextDependencies },
                                                ),
                                              })
                                            }}
                                          />
                                          <FieldLabel
                                            htmlFor={`${parameter.uuid}-dependency-${dependency.uuid}`}
                                          >
                                            {itemName(dependency, dependency.uuid)}
                                          </FieldLabel>
                                        </Field>
                                      ))}
                                    </FieldGroup>
                                  </FieldSet>
                                  <Field>
                                    <FieldLabel htmlFor={`${parameter.uuid}-formula`}>
                                      Restricted CEL formula
                                    </FieldLabel>
                                    <Textarea
                                      id={`${parameter.uuid}-formula`}
                                      className="font-mono text-xs"
                                      rows={4}
                                      value={parameter.expression.source}
                                      disabled={readOnly || saving}
                                      placeholder={`p['${dependencies[0]?.uuid ?? "parameter-uuid"}'] / 3.0`}
                                      onChange={(event) =>
                                        changeVersion({
                                          derived_parameters: replaceItem(
                                            draft.version.derived_parameters,
                                            {
                                              ...parameter,
                                              expression: {
                                                language: "cel",
                                                source: event.target.value,
                                              },
                                            },
                                          ),
                                        })
                                      }
                                    />
                                  </Field>
                                </AccordionContent>
                              </AccordionItem>
                            )
                          })}
                        </Accordion>
                      )}
                    </TabsContent>

                    <TabsContent value="properties" className="flex flex-col gap-4 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-medium">Properties</h3>
                          <p className="text-sm text-muted-foreground">
                            Separate platform, desired, and device-reported state.
                          </p>
                        </div>
                        <AddButton
                          onClick={() =>
                            changeVersion({
                              properties: [
                                ...draft.version.properties,
                                createProperty(nextOrder(draft.version.properties)),
                              ],
                            })
                          }
                        >
                          Add property
                        </AddButton>
                      </div>
                      {draft.version.properties.length === 0 ? (
                        <EmptyRepeater
                          icon={SlidersHorizontalIcon}
                          title="No properties"
                          description="Properties model configuration and reported state outside the telemetry stream."
                          action={
                            <AddButton
                              onClick={() => changeVersion({ properties: [createProperty(10)] })}
                            >
                              Add first property
                            </AddButton>
                          }
                        />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.properties.map((property, index) => (
                            <AccordionItem key={property.uuid} value={property.uuid}>
                              <AccordionTrigger>
                                {itemName(property, `Property ${index + 1}`)}
                              </AccordionTrigger>
                              <AccordionContent className="flex flex-col gap-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <StableId value={property.uuid} />
                                  <RepeaterActions
                                    label={itemName(property, `property ${index + 1}`)}
                                    index={index}
                                    count={draft.version.properties.length}
                                    onMove={(direction) =>
                                      changeVersion({
                                        properties: moveItem(
                                          draft.version.properties,
                                          index,
                                          direction,
                                        ),
                                      })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        properties: draft.version.properties.filter(
                                          (item) => item.uuid !== property.uuid,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                                <SelectField
                                  id={`${property.uuid}-scope`}
                                  label="Property scope"
                                  value={property.scope}
                                  options={["platform", "desired", "reported"] as const}
                                  onChange={(scope) =>
                                    changeVersion({
                                      properties: replaceItem(draft.version.properties, {
                                        ...property,
                                        scope,
                                        ...(scope === "desired"
                                          ? {
                                              acknowledgement: property.acknowledgement ?? {
                                                required: false,
                                                reported_property_uuid: null,
                                              },
                                            }
                                          : { acknowledgement: undefined }),
                                      }),
                                    })
                                  }
                                />
                                <ParameterFields
                                  id={`property-${property.uuid}`}
                                  value={property}
                                  onChange={(next) =>
                                    changeVersion({
                                      properties: replaceItem(
                                        draft.version.properties,
                                        next as ProfileProperty,
                                      ),
                                    })
                                  }
                                />
                                {property.scope === "desired" ? (
                                  <BooleanField
                                    id={`${property.uuid}-acknowledgement`}
                                    label="Require reported acknowledgement"
                                    checked={property.acknowledgement?.required ?? false}
                                    onChange={(required) =>
                                      changeVersion({
                                        properties: replaceItem(draft.version.properties, {
                                          ...property,
                                          acknowledgement: {
                                            required,
                                            reported_property_uuid:
                                              property.acknowledgement?.reported_property_uuid ?? null,
                                          },
                                        }),
                                      })
                                    }
                                  />
                                ) : null}
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      )}
                    </TabsContent>

                    <TabsContent value="events" className="flex flex-col gap-4 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-medium">Events</h3>
                          <p className="text-sm text-muted-foreground">
                            Define stateless occurrences or stateful alarms with typed fields.
                          </p>
                        </div>
                        <AddButton
                          onClick={() =>
                            changeVersion({ events: [...draft.version.events, createEvent()] })
                          }
                        >
                          Add event
                        </AddButton>
                      </div>
                      {draft.version.events.length === 0 ? (
                        <EmptyRepeater
                          icon={ActivityIcon}
                          title="No events"
                          description="Add alarms, faults, transitions, maintenance notices, or other occurrences."
                          action={
                            <AddButton onClick={() => changeVersion({ events: [createEvent()] })}>
                              Add first event
                            </AddButton>
                          }
                        />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.events.map((event, index) => (
                            <AccordionItem key={event.uuid} value={event.uuid}>
                              <AccordionTrigger>
                                {itemName(event, `Event ${index + 1}`)}
                              </AccordionTrigger>
                              <AccordionContent className="flex flex-col gap-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <StableId value={event.uuid} />
                                  <RepeaterActions
                                    label={itemName(event, `event ${index + 1}`)}
                                    index={index}
                                    count={draft.version.events.length}
                                    onMove={(direction) =>
                                      changeVersion({
                                        events: moveItem(draft.version.events, index, direction),
                                      })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        events: draft.version.events.filter(
                                          (item) => item.uuid !== event.uuid,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                                <FieldGroup className="grid gap-4 md:grid-cols-2">
                                  <TextField
                                    id={`${event.uuid}-label`}
                                    label="Event label"
                                    value={event.label}
                                    required
                                    onChange={(label) =>
                                      changeVersion({
                                        events: replaceItem(draft.version.events, {
                                          ...event,
                                          label,
                                          key: event.key || slugKey(label),
                                        }),
                                      })
                                    }
                                  />
                                  <TextField
                                    id={`${event.uuid}-key`}
                                    label="Event key"
                                    value={event.key}
                                    required
                                    onChange={(key) =>
                                      changeVersion({
                                        events: replaceItem(draft.version.events, {
                                          ...event,
                                          key: slugKey(key),
                                        }),
                                      })
                                    }
                                  />
                                  <SelectField
                                    id={`${event.uuid}-mode`}
                                    label="Mode"
                                    value={event.mode}
                                    options={["stateless", "stateful"] as const}
                                    onChange={(mode) =>
                                      changeVersion({
                                        events: replaceItem(draft.version.events, { ...event, mode }),
                                      })
                                    }
                                  />
                                  <SelectField
                                    id={`${event.uuid}-severity`}
                                    label="Default severity"
                                    value={event.default_severity}
                                    options={["info", "notice", "warning", "critical"] as const}
                                    onChange={(default_severity) =>
                                      changeVersion({
                                        events: replaceItem(draft.version.events, {
                                          ...event,
                                          default_severity,
                                        }),
                                      })
                                    }
                                  />
                                  <NumberField
                                    id={`${event.uuid}-dedupe`}
                                    label="Dedupe window seconds"
                                    value={event.dedupe_window_seconds}
                                    min={0}
                                    max={86400}
                                    step={1}
                                    onChange={(dedupe_window_seconds) =>
                                      changeVersion({
                                        events: replaceItem(draft.version.events, {
                                          ...event,
                                          dedupe_window_seconds: dedupe_window_seconds ?? null,
                                        }),
                                      })
                                    }
                                  />
                                </FieldGroup>
                                <NestedEventFields
                                  event={event}
                                  onChange={(next) =>
                                    changeVersion({
                                      events: replaceItem(draft.version.events, next),
                                    })
                                  }
                                />
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      )}
                    </TabsContent>

                    <TabsContent value="commands" className="flex flex-col gap-4 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-medium">Commands</h3>
                          <p className="text-sm text-muted-foreground">
                            Command definitions describe intent and fields. MQTT topics and payload paths live in the Binding.
                          </p>
                        </div>
                        <AddButton
                          onClick={() =>
                            changeVersion({ commands: [...draft.version.commands, createCommand()] })
                          }
                        >
                          Add Command
                        </AddButton>
                      </div>
                      {draft.version.commands.length === 0 ? (
                        <EmptyRepeater
                          icon={BracesIcon}
                          title="No Commands"
                          description="Add setpoints, switches, reset actions, or other platform-to-device intent."
                          action={
                            <AddButton onClick={() => changeVersion({ commands: [createCommand()] })}>
                              Add first Command
                            </AddButton>
                          }
                        />
                      ) : (
                        <Accordion type="multiple" className="rounded-lg border px-4">
                          {draft.version.commands.map((command, index) => (
                            <AccordionItem key={command.uuid} value={command.uuid}>
                              <AccordionTrigger>
                                {itemName(command, `Command ${index + 1}`)}
                              </AccordionTrigger>
                              <AccordionContent className="flex flex-col gap-5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <StableId value={command.uuid} />
                                  <RepeaterActions
                                    label={itemName(command, `Command ${index + 1}`)}
                                    index={index}
                                    count={draft.version.commands.length}
                                    onMove={(direction) =>
                                      changeVersion({
                                        commands: moveItem(draft.version.commands, index, direction),
                                      })
                                    }
                                    onRemove={() =>
                                      changeVersion({
                                        commands: draft.version.commands.filter(
                                          (item) => item.uuid !== command.uuid,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                                <CommandFields
                                  command={command}
                                  onChange={(next) =>
                                    changeVersion({
                                      commands: replaceItem(draft.version.commands, next),
                                    })
                                  }
                                />
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>

            <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
              <JsonPreview
                title="Canonical Profile JSON"
                description="Read-only synchronized authoring contract sent to the API."
                value={draft}
                testId="profile-json-preview"
              />
            </div>
          </div>

          {!readOnly ? (
            <Card>
              <CardFooter className="justify-end pt-6">
                <Button type="submit" disabled={saving}>
                  {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
                  {saving ? "Saving Profile…" : selectedUuid ? "Save Profile draft" : "Create Profile draft"}
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

function NestedEventFields({
  event,
  onChange,
}: {
  event: ProfileEvent
  onChange: (event: ProfileEvent) => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Event fields</p>
          <p className="text-sm text-muted-foreground">Typed payload values carried by this event.</p>
        </div>
        <AddButton
          onClick={() =>
            onChange({
              ...event,
              fields: [...event.fields, createEventField(nextOrder(event.fields))],
            })
          }
        >
          Add event field
        </AddButton>
      </div>
      {event.fields.map((field, index) => (
        <Card key={field.uuid}>
          <CardHeader>
            <CardTitle className="text-base">{itemName(field, `Field ${index + 1}`)}</CardTitle>
            <CardDescription>
              <StableId value={field.uuid} />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ParameterFields
              id={`event-field-${field.uuid}`}
              value={field}
              onChange={(next) =>
                onChange({ ...event, fields: replaceItem(event.fields, next as EventField) })
              }
            />
          </CardContent>
          <CardFooter className="justify-end">
            <RepeaterActions
              label={itemName(field, `event field ${index + 1}`)}
              index={index}
              count={event.fields.length}
              onMove={(direction) => onChange({ ...event, fields: moveItem(event.fields, index, direction) })}
              onRemove={() =>
                onChange({ ...event, fields: event.fields.filter((item) => item.uuid !== field.uuid) })
              }
            />
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

function CommandFields({
  command,
  onChange,
}: {
  command: ProfileCommand
  onChange: (command: ProfileCommand) => void
}) {
  const editorReadOnly = useEditorReadOnly()
  return (
    <div className="flex flex-col gap-5">
      <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TextField
          id={`${command.uuid}-label`}
          label="Command label"
          value={command.label}
          required
          onChange={(label) => onChange({ ...command, label, key: command.key || slugKey(label) })}
        />
        <TextField
          id={`${command.uuid}-key`}
          label="Command key"
          value={command.key}
          required
          onChange={(key) => onChange({ ...command, key: slugKey(key) })}
        />
        <SelectField
          id={`${command.uuid}-mode`}
          label="Mode"
          value={command.mode}
          options={["one_way", "two_way"] as const}
          onChange={(mode) =>
            onChange({
              ...command,
              mode,
              fields:
                mode === "one_way"
                  ? command.fields.filter((field) => field.direction === "input")
                  : command.fields,
            })
          }
        />
        <SelectField
          id={`${command.uuid}-risk`}
          label="Risk"
          value={command.risk}
          options={["low", "medium", "high"] as const}
          onChange={(risk) =>
            onChange({
              ...command,
              risk,
              confirmation_text: risk === "low" ? null : command.confirmation_text || "Confirm this Command.",
            })
          }
        />
        <NumberField
          id={`${command.uuid}-timeout`}
          label="Timeout seconds"
          value={command.timeout_seconds}
          min={1}
          max={86400}
          step={1}
          onChange={(timeout_seconds) => onChange({ ...command, timeout_seconds: timeout_seconds ?? 30 })}
        />
        <SelectField
          id={`${command.uuid}-offline`}
          label="Offline policy"
          value={command.offline_policy}
          options={["reject", "queue_until_expiry"] as const}
          onChange={(offline_policy) => onChange({ ...command, offline_policy })}
        />
        <BooleanField
          id={`${command.uuid}-idempotent`}
          label="Idempotent Command"
          checked={command.idempotent}
          description="Safe retries are allowed only when the Device operation is idempotent."
          onChange={(idempotent) =>
            onChange({ ...command, idempotent, max_attempts: idempotent ? command.max_attempts : 1 })
          }
        />
        <NumberField
          id={`${command.uuid}-attempts`}
          label="Maximum attempts"
          value={command.max_attempts}
          min={1}
          max={10}
          step={1}
          onChange={(max_attempts) => onChange({ ...command, max_attempts: max_attempts ?? 1 })}
        />
      </FieldGroup>
      {command.risk !== "low" ? (
        <TextField
          id={`${command.uuid}-confirmation`}
          label="Confirmation text"
          value={command.confirmation_text}
          required
          description="Shown before a person issues a medium- or high-risk Command."
          onChange={(confirmation_text) => onChange({ ...command, confirmation_text })}
        />
      ) : null}
      <Field>
        <FieldLabel htmlFor={`${command.uuid}-description`}>Description</FieldLabel>
        <Textarea
          id={`${command.uuid}-description`}
          value={command.description ?? ""}
          disabled={editorReadOnly}
          onChange={(event) => onChange({ ...command, description: event.target.value || null })}
        />
      </Field>
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Command fields</p>
            <p className="text-sm text-muted-foreground">
              Required input fields must be collected before publish. Required output fields must appear in a successful response.
            </p>
          </div>
          <AddButton
            onClick={() =>
              onChange({
                ...command,
                fields: [...command.fields, createCommandField(nextOrder(command.fields))],
              })
            }
          >
            Add Command field
          </AddButton>
        </div>
        {command.fields.map((field, index) => (
          <Card key={field.uuid}>
            <CardHeader>
              <CardTitle className="text-base">{itemName(field, `Field ${index + 1}`)}</CardTitle>
              <CardDescription>
                <StableId value={field.uuid} />
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <SelectField
                  id={`${field.uuid}-direction`}
                  label="Direction"
                  value={field.direction}
                  options={command.mode === "one_way" ? (["input"] as const) : (["input", "output"] as const)}
                  onChange={(direction) =>
                    onChange({
                      ...command,
                      fields: replaceItem(command.fields, { ...field, direction }),
                    })
                  }
                />
                <BooleanField
                  id={`${field.uuid}-required`}
                  label="Required field"
                  checked={field.required}
                  onChange={(required) =>
                    onChange({
                      ...command,
                      fields: replaceItem(command.fields, { ...field, required }),
                    })
                  }
                />
              </FieldGroup>
              <ParameterFields
                id={`command-field-${field.uuid}`}
                value={field}
                onChange={(next) =>
                  onChange({
                    ...command,
                    fields: replaceItem(command.fields, next as CommandField),
                  })
                }
              />
            </CardContent>
            <CardFooter className="justify-end">
              <RepeaterActions
                label={itemName(field, `Command field ${index + 1}`)}
                index={index}
                count={command.fields.length}
                onMove={(direction) =>
                  onChange({ ...command, fields: moveItem(command.fields, index, direction) })
                }
                onRemove={() =>
                  onChange({
                    ...command,
                    fields: command.fields.filter((item) => item.uuid !== field.uuid),
                  })
                }
              />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
