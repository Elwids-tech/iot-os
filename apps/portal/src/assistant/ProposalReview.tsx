import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  AssistantChange,
  AssistantProposal,
  AssistantSource,
  AssistantValue,
  IngressConversion,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog"
import { Field, FieldLabel, FieldGroup } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Panel,
  PanelContent,
  PanelHeader,
} from "@iot-os/ui/components/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { Choice, Confirm, RequestError, TextField } from "../components/forms"
import { api } from "../lib/api"
import { IncomingConversionFields } from "../profiles/IncomingConversionFields"
import {
  EDITED_NOTE,
  editedEvidence,
  evidenceTargets,
  fieldDiff,
} from "./state"

const JsonCode = lazy(() => import("@iot-os/ui/components/json-code"))
const enums: Record<string, string[]> = {
  kind: ["state", "measurement", "counter", "event", "derived"],
  data_type: [
    "boolean",
    "integer",
    "number",
    "enum",
    "string",
    "timestamp",
    "bytes",
  ],
  engine: ["json_logic"],
  trigger: ["on_input_change"],
  failure_policy: ["mark_invalid"],
}
const label = (key: string) =>
  key.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase())

/** Where a proposed value came from, in the words the review shows. */
export const evidenceLabel = (origin: string) =>
  ({
    user_stated: "From your message",
    user_confirmed: "Confirmed by you",
    source: "From an attached file",
    suggested: "Suggested",
    unresolved: "Still unknown",
  })[origin] ?? label(origin)

// Nested values remain typed form controls; JSON is a separate, read-only view.
function ValueField({
  name,
  value,
  onChange,
}: {
  name: string
  value: AssistantValue
  onChange: (value: AssistantValue) => void
}) {
  const id = useId()
  const options = enums[name]
  if (options && typeof value === "string")
    return (
      <Choice
        label={label(name)}
        value={value}
        options={options.map((value) => ({ value, label: label(value) }))}
        onChange={onChange}
      />
    )
  if (typeof value === "boolean")
    return (
      <Field orientation="horizontal" className="w-auto">
        <Checkbox
          id={id}
          checked={value}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <FieldLabel htmlFor={id}>{label(name)}</FieldLabel>
      </Field>
    )
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
    return (
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{label(name)}</legend>
        {entries.length ? (
          <Fields
            entries={entries}
            onChange={(key, next) => {
              if (Array.isArray(value)) {
                const changed = [...value]
                changed[Number(key)] = next
                onChange(changed)
              } else onChange({ ...value, [key]: next })
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No values proposed. Ask the assistant to add the details you need.
          </p>
        )}
      </fieldset>
    )
  }
  if (value === null)
    return (
      <Field>
        <FieldLabel>{label(name)}</FieldLabel>
        <p className="text-sm text-muted-foreground">Not set</p>
        <Button variant="outline" size="sm" onClick={() => onChange("")}>
          Set a value
        </Button>
      </Field>
    )
  return (
    <TextField
      label={label(name)}
      type={typeof value === "number" ? "number" : "text"}
      step="any"
      value={value}
      onChange={(event) =>
        onChange(
          typeof value === "number"
            ? event.target.value === ""
              ? ""
              : Number(event.target.value)
            : event.target.value,
        )
      }
    />
  )
}

// Short fields sit in two columns, checkboxes share a row and nested groups span both.
function Fields({
  entries,
  onChange,
  note,
}: {
  entries: [string, AssistantValue][]
  onChange: (key: string, value: AssistantValue) => void
  /** Shown under a top-level field, such as where its value came from. */
  note?: (key: string) => ReactNode
}) {
  const nested = (value: AssistantValue) =>
    value !== null && typeof value === "object"
  const field = ([key, value]: [string, AssistantValue]) => (
    <div key={key} className="flex min-w-0 flex-col gap-1.5">
      <ValueField
        name={key}
        value={value}
        onChange={(next) => onChange(key, next)}
      />
      {note?.(key)}
    </div>
  )
  const flags = entries.filter(([, value]) => typeof value === "boolean")
  return (
    <FieldGroup className="grid gap-x-4 sm:grid-cols-2">
      {entries
        .filter(([, value]) => typeof value !== "boolean" && !nested(value))
        .map(field)}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-2">
          {flags.map(field)}
        </div>
      )}
      {entries
        .filter(([, value]) => nested(value))
        .map((entry) => (
          <div key={entry[0]} className="min-w-0 sm:col-span-2">
            {field(entry)}
          </div>
        ))}
    </FieldGroup>
  )
}

function beforeValue(
  proposal: AssistantProposal,
  change: AssistantChange,
): AssistantValue {
  if (proposal.section === "identity")
    return Object.fromEntries(
      Object.keys(change.values).map((key) => [
        key,
        proposal.before[key] ?? null,
      ]),
    )
  const key = proposal.section === "groups" ? "parameter_groups" : "parameters"
  const items = proposal.before[key]
  if (!Array.isArray(items)) return null
  const item = items.find(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      item.uuid === change.uuid,
  )
  if (!item || Array.isArray(item) || typeof item !== "object") return null
  return proposal.section === "calculations"
    ? (item.calculation ?? null)
    : Object.fromEntries(
        Object.keys(change.values).map((key) => [key, item[key] ?? null]),
      )
}

const show = (value: AssistantValue | undefined) =>
  value === undefined || value === null
    ? "Not set"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value)
const operation = (proposal: AssistantProposal, change: AssistantChange) =>
  change.operation === "remove"
    ? "Remove"
    : change.uuid ||
        (proposal.section === "identity" && proposal.draft_revision !== null)
      ? "Update"
      : "Add"
const operationBadge = {
  Add: "success",
  Update: "info",
  Remove: "destructive",
} as const

type Evidence = AssistantProposal["evidence"][number]

/** A source's note as shown: a plain "you confirmed it" note repeats the label, the edit note says what was suggested. */
function shownNote(item: Evidence) {
  if (item.origin === "user_confirmed" && !item.note?.startsWith(EDITED_NOTE))
    return null
  return item.note?.replace(/`([^`]*)`/g, "“$1”") ?? null
}

/** One line per distinct source, so a value confirmed twice reads once. */
function distinct<T extends { item: Evidence }>(entries: T[]) {
  const line = ({ item }: T) =>
    JSON.stringify([item.origin, item.source_id, item.location, shownNote(item)])
  return entries.filter(
    (entry, i) => entries.findIndex((other) => line(other) === line(entry)) === i,
  )
}

/** One source under a field: where the value came from, its file, and Confirm when it was only suggested. */
function SourceLine({
  item,
  source,
  href,
  onConfirm,
}: {
  item: Evidence
  source?: AssistantSource
  href?: string
  onConfirm?: () => void
}) {
  const open = item.origin === "suggested" || item.origin === "unresolved"
  const note = shownNote(item)
  return (
    <li
      className={
        "flex flex-wrap items-baseline gap-x-1.5 text-meta " +
        (open ? "text-warning" : "text-muted-foreground")
      }
    >
      <span className="font-medium">{evidenceLabel(item.origin)}</span>
      {href && (
        <a
          className="text-primary underline-offset-2 hover:underline"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {source?.name ?? "Source"}
          {item.location ? ` · ${item.location}` : ""}
        </a>
      )}
      {note && <span>· {note}</span>}
      {open && onConfirm && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-meta"
          onClick={onConfirm}
        >
          Confirm
        </Button>
      )}
    </li>
  )
}

function ChangeTitle({
  id,
  proposal,
  change,
}: {
  id?: string
  proposal: AssistantProposal
  change: AssistantChange
}) {
  const action = operation(proposal, change)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge variant={operationBadge[action]}>{action}</Badge>
      <h3 id={id} className="truncate skin-label text-heading">
        {String(
          change.values.label ??
            change.values.name ??
            change.values.key ??
            change.uuid ??
            label(proposal.section),
        )}
      </h3>
    </div>
  )
}

export function ProposalReview({
  org,
  conversation,
  proposal,
  sources,
  dirty,
  busy,
  onClose,
  onPreview,
  onDecision,
}: {
  org: string
  conversation: string
  proposal: AssistantProposal
  sources: AssistantSource[]
  dirty: boolean
  busy: boolean
  onClose: () => void
  onPreview: (proposal: AssistantProposal) => void
  onDecision: (
    proposal: AssistantProposal,
    decision: "approve" | "reject",
  ) => Promise<void>
}) {
  const cache = useQueryClient()
  const id = useId()
  const draftKey = ["assistant-review-draft", org, proposal.id]
  const cached = cache.getQueryData<{
    changes: AssistantChange[]
    evidence: AssistantProposal["evidence"]
  }>(draftKey)
  const [changes, setChanges] = useState(
    () => cached?.changes ?? structuredClone(proposal.changes),
  )
  const [evidence, setEvidence] = useState(
    () => cached?.evidence ?? structuredClone(proposal.evidence),
  )
  useEffect(() => {
    cache.setQueryData(["assistant-review-draft", org, proposal.id], {
      changes,
      evidence,
    })
  }, [cache, org, proposal.id, changes, evidence])
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [dismiss, setDismiss] = useState(false)
  const edited =
    JSON.stringify(changes) !== JSON.stringify(proposal.changes) ||
    JSON.stringify(evidence) !== JSON.stringify(proposal.evidence)
  const blocked = proposal.diagnostics.some((item) => item.blocking)
  const pending = proposal.status === "pending"
  // Compare changes only helps when something existed before; a new item is all additions.
  const comparable = changes.some(
    (change) => operation(proposal, change) !== "Add",
  )
  // Sources are matched against the proposal as sent, so a renamed key keeps its sources.
  const targets = evidenceTargets(evidence, proposal.changes)
  const located = evidence.map((item, index) => ({
    item,
    index,
    target: targets[index],
  }))
  const changedValue = (index: number, key: string) =>
    JSON.stringify(changes[index]?.values[key]) !==
    JSON.stringify(proposal.changes[index]?.values[key])
  const unconfirmed = located.filter(
    ({ item, target }) =>
      (item.origin === "suggested" || item.origin === "unresolved") &&
      !(target && changedValue(target.index, target.key)),
  ).length
  function confirm(index: number) {
    setEvidence((current) =>
      current.map((entry, i) =>
        i === index
          ? {
              ...entry,
              origin: "user_confirmed",
              note: "Explicitly confirmed during section review",
            }
          : entry,
      ),
    )
  }
  const sourceLine = ({ item, index }: (typeof located)[number]) => (
    <SourceLine
      key={index}
      item={item}
      source={sources.find((source) => source.id === item.source_id)}
      href={
        item.source_id
          ? api.assistantSourceUrl(org, conversation, item.source_id)
          : undefined
      }
      onConfirm={pending ? () => confirm(index) : undefined}
    />
  )
  function sourceNote(index: number, key: string) {
    if (changedValue(index, key))
      return (
        <p className="text-meta text-primary">
          Edited by you · the assistant suggested{" "}
          {show(proposal.changes[index]?.values[key])}
        </p>
      )
    const entries = distinct(
      located.filter(
        ({ target }) => target?.index === index && target.key === key,
      ),
    )
    return entries.length ? (
      <ul className="flex flex-col gap-0.5">{entries.map(sourceLine)}</ul>
    ) : null
  }
  // Sources not tied to a field; a bare "you confirmed it" says nothing without one.
  const loose = distinct(
    located.filter(
      ({ item, target }) =>
        !target && (shownNote(item) || item.source_id || item.origin !== "user_confirmed"),
    ),
  )
  // One step: edits are checked as a new proposal and saved when nothing blocks;
  // otherwise the checked proposal opens here with its issues.
  async function save() {
    setSaving(true)
    setError(null)
    try {
      let checked = proposal
      if (edited) {
        checked = await api.assistantPreview(org, conversation, {
          section: proposal.section,
          summary: proposal.summary,
          changes,
          evidence: editedEvidence(proposal, changes, evidence),
        })
        if (checked.diagnostics.some((item) => item.blocking)) {
          onPreview(checked)
          return
        }
      }
      await onDecision(checked, "approve")
      onClose()
    } catch (error) {
      setError(error)
    } finally {
      setSaving(false)
    }
  }
  async function decide(decision: "approve" | "reject") {
    setSaving(true)
    setError(null)
    try {
      await onDecision(proposal, decision)
      onClose()
    } catch (error) {
      setError(error)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[92svh] flex-col sm:max-w-5xl"
        onInteractOutside={(event) => {
          if (edited || saving) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Review {label(proposal.section).toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {proposal.summary.replace(/\.$/, "")}. Saving checks these values
            and adds them to the profile draft.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {(proposal.draft_revision === null || !pending) && (
            <div className="flex flex-wrap gap-2">
              {proposal.draft_revision === null && (
                <Badge variant="secondary">New profile</Badge>
              )}
              {!pending && <Badge variant="outline">{proposal.status}</Badge>}
            </div>
          )}
          <RequestError error={error} />
          {dirty && (
            <Alert>
              <AlertTitle>Your form has unsaved edits</AlertTitle>
              <AlertDescription>
                Save or discard those edits in the form before saving this
                section. Your form is kept intact.
              </AlertDescription>
            </Alert>
          )}
          <Tabs defaultValue="fields">
            <TabsList
              className={
                "grid w-full gap-1 group-data-[orientation=horizontal]/tabs:h-auto " +
                (comparable ? "grid-cols-3" : "grid-cols-2")
              }
            >
              <TabsTrigger value="fields">Edit fields</TabsTrigger>
              {comparable && (
                <TabsTrigger value="changes">Compare changes</TabsTrigger>
              )}
              <TabsTrigger value="json">JSON · read only</TabsTrigger>
            </TabsList>
            <TabsContent value="fields" className="flex flex-col gap-4">
              {pending && unconfirmed > 0 && (
                <p className="text-sm text-warning">
                  {unconfirmed === 1
                    ? "1 value was suggested by the assistant."
                    : unconfirmed + " values were suggested by the assistant."}{" "}
                  Confirm or change {unconfirmed === 1 ? "it" : "them"} below.
                </p>
              )}
              {changes.map((change, index) => (
                <Panel key={index} className="shrink-0 border">
                  <PanelHeader>
                    <ChangeTitle
                      id={`${id}-change-${index}`}
                      proposal={proposal}
                      change={change}
                    />
                  </PanelHeader>
                  <PanelContent>
                    <fieldset
                      aria-labelledby={`${id}-change-${index}`}
                      disabled={!pending || saving || busy}
                      className="min-w-0"
                    >
                      {change.operation === "remove" ? (
                        <Alert>
                          <AlertTitle>Removal</AlertTitle>
                          <AlertDescription>
                            This item will be removed from the draft. Existing
                            published versions remain available.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <FieldGroup>
                          {proposal.section === "parameters" &&
                            "ingress_conversion" in change.values && (
                              <IncomingConversionFields
                                value={
                                  change.values
                                    .ingress_conversion as IngressConversion | null
                                }
                                storedUnit={
                                  typeof change.values.unit === "string"
                                    ? change.values.unit
                                    : null
                                }
                                dataType={String(change.values.data_type)}
                                eligible={
                                  ["measurement", "counter"].includes(
                                    String(change.values.kind),
                                  ) &&
                                  ["number", "integer"].includes(
                                    String(change.values.data_type),
                                  ) &&
                                  change.values.accepts_command !== true &&
                                  change.values.reports_state !== false
                                }
                                onChange={(value) =>
                                  setChanges((current) =>
                                    current.map((item, i) =>
                                      i === index
                                        ? {
                                            ...item,
                                            values: {
                                              ...item.values,
                                              ingress_conversion: value,
                                            },
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            )}
                          {proposal.section === "calculations" &&
                            change.values.output && (
                              <p className="text-sm text-muted-foreground">
                                This saves the new output and its formula together.
                                Inputs use stored values after any incoming
                                conversion.
                              </p>
                            )}
                          <Fields
                            note={(key) => sourceNote(index, key)}
                            entries={Object.entries(change.values).filter(
                              ([key]) =>
                                key !== "ingress_conversion" ||
                                proposal.section !== "parameters",
                            )}
                            onChange={(key, next) =>
                              setChanges((current) =>
                                current.map((item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        values: { ...item.values, [key]: next },
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </FieldGroup>
                      )}
                    </fieldset>
                  </PanelContent>
                </Panel>
              ))}
              {loose.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium">Other sources</h3>
                  <ul className="flex flex-col gap-0.5">{loose.map(sourceLine)}</ul>
                </section>
              )}
              <p className="text-sm text-muted-foreground">
                {evidence.length
                  ? ""
                  : "No sources were attached, so check the values against your device documentation. "}
                Need a different structure, more fields, or another parameter?
                Close this review and describe the change in chat.
              </p>
            </TabsContent>
            <TabsContent value="changes" className="flex flex-col gap-6">
              {changes.map((change, index) => {
                const rows = fieldDiff(
                  beforeValue(proposal, change),
                  change.operation === "remove" ? null : change.values,
                )
                return (
                  <section key={index} className="flex min-w-0 flex-col gap-2">
                    <ChangeTitle proposal={proposal} change={change} />
                    {rows.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Field</TableHead>
                            <TableHead>Before</TableHead>
                            <TableHead>After</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => (
                            <TableRow key={row.field}>
                              <TableCell className="align-top">
                                {row.field.split(".").map(label).join(" · ")}
                              </TableCell>
                              <TableCell className="align-top whitespace-normal break-all text-muted-foreground">
                                {show(row.before)}
                              </TableCell>
                              <TableCell className="align-top whitespace-normal break-all">
                                {change.operation === "remove"
                                  ? "Removed"
                                  : show(row.after)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No field changes.
                      </p>
                    )}
                  </section>
                )
              })}
            </TabsContent>
            <TabsContent value="json">
              <div className="h-96 overflow-hidden rounded-lg border">
                <Suspense fallback={<Skeleton className="h-full" />}>
                  <JsonCode
                    readOnly
                    label="Proposed section JSON"
                    value={JSON.stringify(
                      { section: proposal.section, changes },
                      null,
                      2,
                    )}
                  />
                </Suspense>
              </div>
            </TabsContent>
          </Tabs>
          {/* Issues belong to the proposal as sent; after an edit, saving checks again. */}
          {!edited &&
            proposal.diagnostics.map((item, index) => (
              <Alert
                key={index}
                variant={item.blocking ? "destructive" : "default"}
              >
                <AlertTitle>
                  {item.blocking
                    ? "Resolve before saving"
                    : "Still needed before publication"}
                </AlertTitle>
                <AlertDescription>{item.message}</AlertDescription>
              </Alert>
            ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Keep reviewing later
          </Button>
          {pending && (
            <>
              <Button
                variant="outline"
                disabled={saving || busy}
                onClick={() => setDismiss(true)}
              >
                Dismiss proposal
              </Button>
              <Button
                disabled={saving || busy || dirty || (blocked && !edited)}
                onClick={() => void save()}
              >
                {saving
                  ? edited
                    ? "Checking and saving…"
                    : "Saving…"
                  : "Save this section"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
      <Confirm
        open={dismiss}
        title="Dismiss this proposal?"
        description="The suggested changes for this section are discarded. Ask the assistant in chat for a new proposal."
        action="Dismiss proposal"
        onClose={() => setDismiss(false)}
        onConfirm={() => decide("reject")}
      />
    </Dialog>
  )
}
