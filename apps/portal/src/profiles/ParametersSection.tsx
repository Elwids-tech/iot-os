import { Fragment, useMemo, useState, useDeferredValue } from "react"
import { useForm } from "react-hook-form"
import type { AuthoringParameter, ProfileGroup } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@iot-os/ui/components/table"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@iot-os/ui/components/accordion"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@iot-os/ui/components/empty"
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  ListOrderedIcon,
} from "lucide-react"
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
} from "../components/forms"
import { useStudio } from "./use-studio"
import { ParameterEditor } from "./ParameterEditor"
import { ConflictReview } from "./ConflictReview"
export function ParametersSection() {
  const studio = useStudio(),
    { profile } = studio
  const canEdit =
    studio.capabilities.update &&
    profile.status !== "archived" &&
    !studio.blocked
  const [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [page, setPage] = useState(1)
  const deferred = useDeferredValue(search.toLowerCase())
  const [editing, setEditing] = useState<AuthoringParameter | "new" | null>(
    null,
  )
  const [groupEditor, setGroupEditor] = useState<ProfileGroup | "new" | null>(
    null,
  )
  const [deleting, setDeleting] = useState<{
    kind: "parameter" | "group"
    revision: number
    uuid: string
    label: string
  } | null>(null)
  const [order, setOrder] = useState<{
    kind: "parameters" | "groups"
    ids: string[]
    revision: number
  } | null>(null)
  const [error, setError] = useState<unknown>(null)
  useUnsaved(Boolean(order))
  const groupNames = useMemo(
    () =>
      new Map(profile.parameter_groups.map((item) => [item.uuid, item.label])),
    [profile.parameter_groups],
  )
  const filtered = useMemo(
    () =>
      profile.parameters.filter(
        (item) =>
          (!group ||
            (group === "ungrouped"
              ? !item.parameter_group_uuid
              : item.parameter_group_uuid === group)) &&
          (item.label + " " + item.key).toLowerCase().includes(deferred),
      ),
    [profile.parameters, group, deferred],
  )
  const grouped = useMemo(() => {
    const rank = new Map(
      profile.parameter_groups.map((item, index) => [item.uuid, index]),
    )
    return [...filtered].sort(
      (a, b) =>
        (rank.get(a.parameter_group_uuid ?? "") ?? rank.size) -
          (rank.get(b.parameter_group_uuid ?? "") ?? rank.size) ||
        a.sort_order - b.sort_order,
    )
  }, [filtered, profile.parameter_groups])
  const ordered =
    order?.kind === "parameters"
      ? order.ids
          .map((uuid) => profile.parameters.find((item) => item.uuid === uuid)!)
          .filter(Boolean)
      : grouped
  const visible =
    order?.kind === "parameters"
      ? ordered
      : ordered.slice((page - 1) * 25, page * 25)
  function move(index: number, direction: number) {
    if (!order) return
    const ids = [...order.ids]
    ;[ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]
    setOrder({ ...order, ids })
  }
  async function saveOrder() {
    if (!order) return
    try {
      setError(null)
      await studio.perform(() =>
        order.kind === "parameters"
          ? api.reorderProfileParameters(
              studio.org,
              profile.uuid,
              order.ids,
              order.revision,
            )
          : api.reorderProfileGroups(
              studio.org,
              profile.uuid,
              order.ids,
              order.revision,
            ),
      )
      setOrder(null)
    } catch (reason) {
      setError(reason)
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Parameters</CardTitle>
              <CardDescription>
                Measurements, states, counters, events, and derived values.
              </CardDescription>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={
                    Boolean(order) ||
                    Boolean(search || group) ||
                    studio.busy ||
                    profile.parameters.length < 2
                  }
                  onClick={() =>
                    setOrder({
                      kind: "parameters",
                      ids: profile.parameters.map((item) => item.uuid),
                      revision: profile.draft_revision,
                    })
                  }
                >
                  <ListOrderedIcon data-icon="inline-start" />
                  Reorder
                </Button>
                <Button
                  disabled={Boolean(order) || studio.busy}
                  onClick={() => setEditing("new")}
                >
                  <PlusIcon data-icon="inline-start" />
                  Add parameter
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Search parameters"
              placeholder="Label or stable key…"
              type="search"
              value={search}
              disabled={Boolean(order)}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
            <Choice
              label="Parameter group"
              value={group}
              disabled={Boolean(order)}
              options={[
                { value: "", label: "All groups" },
                { value: "ungrouped", label: "Ungrouped" },
                ...profile.parameter_groups.map((item) => ({
                  value: item.uuid,
                  label: item.label,
                })),
              ]}
              onChange={(value) => {
                setGroup(value)
                setPage(1)
              }}
            />
          </FieldGroup>
          {order?.kind === "parameters" && (
            <p className="text-sm text-muted-foreground">
              Reorder the complete parameter sequence using the labeled move
              buttons. Group membership is unchanged. Save the order when
              finished.
            </p>
          )}
          {!visible.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {search || group
                    ? "No matching parameters"
                    : "Add the first parameter"}
                </EmptyTitle>
                <EmptyDescription>
                  Describe a value such as power, temperature, voltage, or
                  imported energy.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Kind / type</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((parameter, index) => (
                    <Fragment key={parameter.uuid}>
                      {!order &&
                        (index === 0 ||
                          visible[index - 1].parameter_group_uuid !==
                            parameter.parameter_group_uuid) && (
                          <TableRow className="bg-muted/50">
                            <TableCell colSpan={5} className="font-semibold">
                              {groupNames.get(
                                parameter.parameter_group_uuid ?? "",
                              ) ?? "Ungrouped"}
                            </TableCell>
                          </TableRow>
                        )}
                      <TableRow>
                        <TableCell>
                          <Button
                            variant="link"
                            className="h-auto px-0"
                            onClick={() => setEditing(parameter)}
                            disabled={Boolean(order)}
                          >
                            {parameter.label}
                          </Button>
                          <p className="font-mono text-xs text-muted-foreground">
                            {parameter.key}
                            {parameter.unit ? " · " + parameter.unit : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant="secondary">{parameter.kind}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {parameter.data_type}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {groupNames.get(
                            parameter.parameter_group_uuid ?? "",
                          ) ?? "Ungrouped"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {parameter.reports_state
                            ? "Reports state"
                            : "Local only"}
                          {parameter.accepts_command
                            ? " · Accepts commands"
                            : ""}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {order?.kind === "parameters" ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  aria-label={"Move " + parameter.label + " up"}
                                  disabled={index === 0}
                                  onClick={() => move(index, -1)}
                                >
                                  <ArrowUpIcon />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="icon-sm"
                                  aria-label={
                                    "Move " + parameter.label + " down"
                                  }
                                  disabled={index === visible.length - 1}
                                  onClick={() => move(index, 1)}
                                >
                                  <ArrowDownIcon />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={
                                    (canEdit ? "Edit " : "Inspect ") +
                                    parameter.label
                                  }
                                  disabled={Boolean(order)}
                                  onClick={() => setEditing(parameter)}
                                >
                                  <PencilIcon />
                                </Button>
                                {canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={"Delete " + parameter.label}
                                    disabled={Boolean(order) || studio.busy}
                                    onClick={() =>
                                      setDeleting({
                                        kind: "parameter",
                                        revision: profile.draft_revision,
                                        uuid: parameter.uuid,
                                        label: parameter.label,
                                      })
                                    }
                                  >
                                    <Trash2Icon />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!order && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {filtered.length} parameters
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs">Page {page}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * 25 >= filtered.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Accordion
        type="single"
        collapsible
        defaultValue={order?.kind === "groups" ? "groups" : undefined}
      >
        <AccordionItem value="groups">
          <AccordionTrigger>
            Manage parameter groups ({profile.parameter_groups.length})
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3">
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(order)}
                    onClick={() => setGroupEditor("new")}
                  >
                    New group
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      Boolean(order) || profile.parameter_groups.length < 2
                    }
                    onClick={() =>
                      setOrder({
                        kind: "groups",
                        ids: profile.parameter_groups.map((item) => item.uuid),
                        revision: profile.draft_revision,
                      })
                    }
                  >
                    Reorder groups
                  </Button>
                </div>
              )}
              {(order?.kind === "groups"
                ? order.ids.map((uuid) =>
                    profile.parameter_groups.find(
                      (item) => item.uuid === uuid,
                    )!,
                  )
                : profile.parameter_groups
              ).map((item, index, list) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  key={item.uuid}
                >
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.description ?? item.code}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      {order?.kind === "groups" ? (
                        <>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label={"Move group " + item.label + " up"}
                            disabled={!index}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label={"Move group " + item.label + " down"}
                            disabled={index === list.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDownIcon />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={"Edit group " + item.label}
                            disabled={Boolean(order)}
                            onClick={() => setGroupEditor(item)}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={"Delete group " + item.label}
                            disabled={Boolean(order)}
                            onClick={() =>
                              setDeleting({
                                kind: "group",
                                revision: profile.draft_revision,
                                uuid: item.uuid,
                                label: item.label,
                              })
                            }
                          >
                            <Trash2Icon />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {order && (
        <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <span className="text-sm">
            Unsaved {order.kind === "groups" ? "group" : "parameter"} order
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={studio.busy}
              onClick={() => setOrder(null)}
            >
              Cancel reordering
            </Button>
            <Button
              disabled={studio.busy || studio.blocked}
              onClick={saveOrder}
            >
              {studio.busy ? "Saving…" : "Save order"}
            </Button>
          </div>
        </div>
      )}
      <RequestError error={error} />
      {order && (
        <ConflictReview
          error={error}
          local={order.ids}
          selectLatest={(fresh) =>
            (order.kind === "parameters"
              ? fresh.parameters
              : fresh.parameter_groups
            ).map((item) => ({ uuid: item.uuid, label: item.label }))
          }
          onRebase={(revision) => {
            const currentIds = (
              order.kind === "parameters"
                ? studio.profile.parameters
                : studio.profile.parameter_groups
            ).map((item) => item.uuid)
            setOrder({
              ...order,
              revision,
              ids: [
                ...order.ids.filter((uuid) => currentIds.includes(uuid)),
                ...currentIds.filter((uuid) => !order.ids.includes(uuid)),
              ],
            })
            setError(null)
          }}
        />
      )}
      {editing && (
        <ParameterEditor
          parameter={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {groupEditor && (
        <GroupEditor
          group={groupEditor === "new" ? null : groupEditor}
          onClose={() => setGroupEditor(null)}
        />
      )}
      <Confirm
        open={Boolean(deleting)}
        title={"Delete " + deleting?.label + "?"}
        description={
          deleting?.kind === "group"
            ? "Its parameters will move to Ungrouped. No parameters will be deleted."
            : "This removes the parameter from the draft, including its own calculation. Referenced parameters cannot be deleted; published revisions are unchanged."
        }
        onClose={() => setDeleting(null)}
        onRefresh={studio.reload}
        onConfirm={async () => {
          if (!deleting) return
          await studio.perform(() =>
            deleting.kind === "group"
              ? api.deleteProfileGroup(
                  studio.org,
                  profile.uuid,
                  deleting.uuid,
                  deleting.revision,
                )
              : api.deleteProfileParameter(
                  studio.org,
                  profile.uuid,
                  deleting.uuid,
                  deleting.revision,
                ),
          )
        }}
      />
    </div>
  )
}
function GroupEditor({
  group,
  onClose,
}: {
  group: ProfileGroup | null
  onClose: () => void
}) {
  const studio = useStudio(),
    [revision, setRevision] = useState(studio.profile.draft_revision),
    [error, setError] = useState<unknown>(null)
  const form = useForm({
    defaultValues: {
      code: group?.code ?? "",
      label: group?.label ?? "",
      description: group?.description ?? "",
    },
  })
  useUnsaved(form.formState.isDirty)
  return (
    <EditorSheet
      title={group ? "Edit group" : "New parameter group"}
      description="Groups organize the authoring view; they do not contain protocol settings."
      dirty={form.formState.isDirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            setError(null)
            await studio.perform(() =>
              api.saveProfileGroup(
                studio.org,
                studio.profile.uuid,
                group?.uuid ?? null,
                {
                  ...values,
                  draft_revision: revision,
                  sort_order:
                    group?.sort_order ??
                    Math.max(
                      -1,
                      ...studio.profile.parameter_groups.map(
                        (item) => item.sort_order,
                      ),
                    ) + 1,
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
              label="Group label"
              error={fieldError(error, "label")}
              required
              {...form.register("label")}
            />
            <TextField
              label="Group code"
              error={fieldError(error, "code")}
              required
              pattern="[a-z0-9][a-z0-9.\-]*"
              {...form.register("code")}
            />
            <TextField
              label="Group description"
              {...form.register("description")}
            />
            <RequestError error={error} />
            <ConflictReview
              error={error}
              local={form.watch()}
              selectLatest={(fresh) =>
                fresh.parameter_groups.find((item) => item.uuid === group?.uuid)
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
          busy={form.formState.isSubmitting}
          disabled={studio.blocked}
          onCancel={onClose}
          label="Save group"
        />
      </form>
    </EditorSheet>
  )
}
