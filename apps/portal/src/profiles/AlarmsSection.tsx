import { useState } from "react"
import { useForm } from "react-hook-form"
import type { AuthoringAlarm } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@iot-os/ui/components/table"
import { FieldGroup, Field, FieldLabel } from "@iot-os/ui/components/field"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@iot-os/ui/components/accordion"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  Choice,
  TextField,
  EditorSheet,
  SaveBar,
  RequestError,
  fieldError,
  Confirm,
  parseObject,
} from "../components/forms"
import { jsonText, kindLabel, objectValue, updateConfig } from "./authoring"
import { plural } from "./ProfileDirectory"
import { useStudio } from "./use-studio"
import { ConflictReview } from "./ConflictReview"
export function AlarmsSection() {
  const studio = useStudio(),
    [editing, setEditing] = useState<AuthoringAlarm | "new" | null>(null),
    [deleting, setDeleting] = useState<AuthoringAlarm | null>(null)
  const [deletionRevision, setDeletionRevision] = useState(
    studio.profile.draft_revision,
  )
  const canEdit =
    studio.capabilities.update &&
    studio.profile.status !== "archived" &&
    !studio.blocked
  const labels = new Map(
    studio.profile.parameters.map((item) => [item.uuid, item.label]),
  )
  const templates = studio.profile.alarm_templates
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {plural(templates.length, "template")}
        </span>
        {canEdit && (
          <Button
            className="ml-auto"
            disabled={studio.busy}
            onClick={() => setEditing("new")}
          >
            <PlusIcon data-icon="inline-start" />
            Add alarm template
          </Button>
        )}
      </div>
      {!templates.length ? (
        <p className="text-sm text-muted-foreground">
          No alarm templates yet. A profile can be published without any.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Suggested severity</TableHead>
              <TableHead>On by default</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((alarm) => {
              const age = alarm.condition_config.max_age_seconds
              const condition =
                alarm.type === "staleness" && typeof age === "number"
                  ? "Older than " + age + " s"
                  : JSON.stringify(alarm.condition_config)
              return (
                <TableRow key={alarm.uuid}>
                  <TableCell className="max-w-72 truncate">{alarm.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {kindLabel(alarm.type)}
                  </TableCell>
                  <TableCell className="max-w-60 truncate text-muted-foreground">
                    {alarm.parameter_references
                      .map((item) => labels.get(item.parameter_uuid) ?? "Missing parameter")
                      .join(", ")}
                  </TableCell>
                  <TableCell
                    className="max-w-60 truncate font-mono text-xs text-muted-foreground"
                    title={condition}
                  >
                    {condition}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {alarm.severity}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {alarm.enabled_by_default ? "Yes" : "No"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(alarm)}
                      >
                        {canEdit ? "Edit" : "Inspect"}
                      </Button>
                      {canEdit && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={"Delete " + alarm.name}
                          disabled={studio.busy}
                          onClick={() => {
                            setDeletionRevision(studio.profile.draft_revision)
                            setDeleting(alarm)
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Templates are suggestions that travel with the profile. They don't
        create workflow alerts, and workflow alerts don't use suggested
        severity.
      </p>
      {editing && (
        <AlarmEditor
          alarm={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <Confirm
        open={Boolean(deleting)}
        title="Delete this alarm template?"
        description="It's removed from the draft. Published versions don't change."
        onClose={() => setDeleting(null)}
        onRefresh={studio.reload}
        onConfirm={async () => {
          if (deleting)
            await studio.perform(() =>
              api.deleteProfileAlarm(
                studio.org,
                studio.profile.uuid,
                deleting.uuid,
                deletionRevision,
              ),
            )
        }}
      />
    </div>
  )
}
function AlarmEditor({
  alarm,
  onClose,
}: {
  alarm: AuthoringAlarm | null
  onClose: () => void
}) {
  const studio = useStudio(),
    [revision, setRevision] = useState(studio.profile.draft_revision),
    [error, setError] = useState<unknown>(null)
  const form = useForm({
    defaultValues: {
      code: alarm?.code ?? "",
      name: alarm?.name ?? "",
      type: alarm?.type ?? "staleness",
      severity: alarm?.severity ?? "warning",
      enabled_by_default: alarm?.enabled_by_default ?? true,
      condition_config: jsonText(
        alarm?.condition_config ?? { max_age_seconds: 300 },
      ),
      parameter_references: alarm?.parameter_references ?? [],
    },
  })
  const values = form.watch(),
    disabled =
      !studio.capabilities.update ||
      studio.profile.status === "archived" ||
      studio.blocked
  useUnsaved(form.formState.isDirty)
  let config: ReturnType<typeof objectValue> = null
  try {
    config = objectValue(values.condition_config)
  } catch {}
  return (
    <EditorSheet
      title={alarm ? "Edit alarm template" : "Add alarm template"}
      description="A suggestion saved with the profile. It doesn't create alerts."
      dirty={form.formState.isDirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (input) => {
          try {
            setError(null)
            await studio.perform(() =>
              api.saveProfileAlarm(
                studio.org,
                studio.profile.uuid,
                alarm?.uuid ?? null,
                {
                  ...input,
                  condition_config: parseObject(input.condition_config, false)!,
                  draft_revision: revision,
                },
              ),
            )
            onClose()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-y-auto p-6">
          <FieldGroup>
            <TextField
              label="Template name"
              error={fieldError(error, "name")}
              required
              disabled={disabled}
              {...form.register("name")}
            />
            <TextField
              label="Template code"
              error={fieldError(error, "code")}
              required
              pattern="[a-z0-9][a-z0-9.\-]*"
              disabled={disabled}
              {...form.register("code")}
            />
            <TextField
              label="Template type"
              required
              disabled={disabled}
              help="Staleness has a duration field. Other types keep their condition JSON."
              {...form.register("type")}
            />
            <Choice
              label="Suggested severity"
              value={values.severity}
              disabled={disabled}
              options={Array.from(
                new Set(["info", "warning", "critical", values.severity]),
              ).map((value) => ({ value, label: value }))}
              onChange={(value) =>
                form.setValue("severity", value, { shouldDirty: true })
              }
            />
            <Field orientation="horizontal">
              <Checkbox
                id="alarm-default"
                checked={values.enabled_by_default}
                disabled={disabled}
                onCheckedChange={(value) =>
                  form.setValue("enabled_by_default", value === true, {
                    shouldDirty: true,
                  })
                }
              />
              <FieldLabel htmlFor="alarm-default">
                Suggest this template by default
              </FieldLabel>
            </Field>
            {values.type === "staleness" && config && (
              <TextField
                label="Maximum age (seconds)"
                type="number"
                min="1"
                required
                disabled={disabled}
                value={
                  typeof config.max_age_seconds === "number"
                    ? config.max_age_seconds
                    : ""
                }
                onChange={(event) =>
                  form.setValue(
                    "condition_config",
                    updateConfig(
                      values.condition_config,
                      "max_age_seconds",
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                    ),
                    { shouldDirty: true },
                  )
                }
              />
            )}
            <Accordion
              type="single"
              collapsible
              defaultValue={
                values.type !== "staleness" || !config ? "condition" : undefined
              }
            >
              <AccordionItem value="condition">
                <AccordionTrigger>Advanced condition JSON</AccordionTrigger>
                <AccordionContent>
                  <JsonEditor
                    label="Alarm condition configuration"
                    value={values.condition_config}
                    readOnly={disabled}
                    onChange={(value) =>
                      form.setValue("condition_config", value, {
                        shouldDirty: true,
                      })
                    }
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            {values.parameter_references.map((reference, index) => (
              <FieldGroup key={index} className="rounded-lg border p-3">
                <Choice
                  label={"Referenced parameter " + (index + 1)}
                  value={reference.parameter_uuid}
                  disabled={disabled}
                  options={[
                    { value: "", label: "Choose parameter" },
                    ...studio.profile.parameters.map((item) => ({
                      value: item.uuid,
                      label: item.label,
                    })),
                  ]}
                  onChange={(value) =>
                    form.setValue(
                      "parameter_references",
                      values.parameter_references.map((item, i) =>
                        i === index ? { ...item, parameter_uuid: value } : item,
                      ),
                      { shouldDirty: true },
                    )
                  }
                />
                <TextField
                  label={"Reference role " + (index + 1)}
                  required
                  disabled={disabled}
                  value={reference.role}
                  placeholder="subject, input, or reference"
                  onChange={(event) =>
                    form.setValue(
                      "parameter_references",
                      values.parameter_references.map((item, i) =>
                        i === index
                          ? { ...item, role: event.target.value }
                          : item,
                      ),
                      { shouldDirty: true },
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    form.setValue(
                      "parameter_references",
                      values.parameter_references.filter((_, i) => i !== index),
                      { shouldDirty: true },
                    )
                  }
                >
                  Remove reference
                </Button>
              </FieldGroup>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                form.setValue(
                  "parameter_references",
                  [
                    ...values.parameter_references,
                    { parameter_uuid: "", role: "subject" },
                  ],
                  { shouldDirty: true },
                )
              }
            >
              Add parameter reference
            </Button>
            <RequestError error={error} />
            <ConflictReview
              error={error}
              local={values}
              selectLatest={(fresh) =>
                fresh.alarm_templates.find((item) => item.uuid === alarm?.uuid)
              }
              onRebase={(value) => {
                setRevision(value)
                setError(null)
              }}
            />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={form.formState.isDirty}
          busy={form.formState.isSubmitting || studio.busy}
          disabled={disabled}
          onCancel={onClose}
          label="Save alarm template"
        />
      </form>
    </EditorSheet>
  )
}
