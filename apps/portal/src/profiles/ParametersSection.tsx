import { useMemo, useState, useDeferredValue } from "react"
import { useForm } from "react-hook-form"
import { Link } from "react-router-dom"
import type { AuthoringParameter, ProfileGroup } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@iot-os/ui/components/select"
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
  ChevronDownIcon,
} from "lucide-react"
import { cn } from "@iot-os/ui/lib/utils"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  TextField,
  EditorSheet,
  SaveBar,
  RequestError,
  fieldError,
  Confirm,
  Pager,
} from "../components/forms"
import { useStudio } from "./use-studio"
import { ParameterEditor } from "./ParameterEditor"
import { ConflictReview } from "./ConflictReview"
import { plural } from "./ProfileDirectory"
import { jsonText, kindLabel, readValidation, ruleLabel } from "./authoring"
const perPage = 25
export function ParametersSection() {
  const studio = useStudio(),
    { profile } = studio
  const canEdit =
    studio.capabilities.update &&
    profile.status !== "archived" &&
    !studio.blocked
  const [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [page, setPage] = useState(1),
    [collapsed, setCollapsed] = useState(new Set<string>())
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
  // Groups in group order, each with its parameters in parameter order.
  const sections = useMemo(() => {
    const rank = new Map(
      profile.parameter_groups.map((item, index) => [item.uuid, index]),
    )
    const byGroup = new Map<string, AuthoringParameter[]>()
    for (const item of [...filtered].sort(
      (a, b) =>
        (rank.get(a.parameter_group_uuid ?? "") ?? rank.size) -
          (rank.get(b.parameter_group_uuid ?? "") ?? rank.size) ||
        a.sort_order - b.sort_order,
    )) {
      const key = item.parameter_group_uuid ?? ""
      byGroup.set(key, [...(byGroup.get(key) ?? []), item])
    }
    return [...byGroup.entries()]
  }, [filtered, profile.parameter_groups])
  // Pages count parameter rows; a group header sits before its first row and repeats on the next page.
  const items: Array<{ group: string; parameter?: AuthoringParameter }> =
    sections.flatMap(([key, rows]) => [
      { group: key },
      ...(collapsed.has(key) ? [] : rows.map((parameter) => ({ group: key, parameter }))),
    ])
  const rowCount = items.filter((item) => item.parameter).length
  const pages = Math.max(1, Math.ceil(rowCount / perPage)),
    shownPage = Math.min(page, pages)
  let seen = 0
  const pageItems = items.filter((item) => {
    const index = item.parameter ? seen++ : Math.min(seen, Math.max(0, rowCount - 1))
    return Math.floor(index / perPage) + 1 === shownPage
  })
  if (pageItems[0]?.parameter) pageItems.unshift({ group: pageItems[0].group })
  const counts = new Map(sections.map(([key, rows]) => [key, rows.length]))
  const ordering = order?.kind === "parameters"
  const ordered = ordering
    ? order.ids
        .map((uuid) => profile.parameters.find((item) => item.uuid === uuid)!)
        .filter(Boolean)
    : []
  function move(index: number, target: number) {
    if (!order || target < 0 || target >= order.ids.length) return
    const ids = [...order.ids]
    ids.splice(target, 0, ...ids.splice(index, 1))
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
  const filters = Boolean(search || group)
  const reorderBlocked = filters
    ? "Clear the search and group filter to reorder"
    : profile.parameters.length < 2
      ? "Add at least two parameters to reorder"
      : undefined
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label htmlFor="parameter-search" className="sr-only">
          Search parameters
        </Label>
        <Input
          id="parameter-search"
          type="search"
          placeholder="Label or key"
          className="w-full sm:w-56"
          value={search}
          disabled={Boolean(order)}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <div className="flex items-center gap-2">
          <Label htmlFor="parameter-group" className="font-normal text-muted-foreground">
            Group
          </Label>
          <Select
            value={group || "all"}
            disabled={Boolean(order)}
            onValueChange={(value) => {
              setGroup(value === "all" ? "" : value)
              setPage(1)
            }}
          >
            <SelectTrigger id="parameter-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              <SelectItem value="ungrouped">Ungrouped</SelectItem>
              {profile.parameter_groups.map((item) => (
                <SelectItem key={item.uuid} value={item.uuid}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {plural(filtered.length, "parameter")}
        </span>
        {canEdit && (
          <div className="flex gap-2 sm:ml-auto">
            <span title={reorderBlocked}>
              <Button
                variant="outline"
                disabled={Boolean(order || reorderBlocked) || studio.busy}
                onClick={() =>
                  setOrder({
                    kind: "parameters",
                    ids: profile.parameters.map((item) => item.uuid),
                    revision: profile.draft_revision,
                  })
                }
              >
                Reorder
              </Button>
            </span>
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
      {ordering ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Position</TableHead>
              <TableHead>Parameter</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>
                <span className="sr-only">Move</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((parameter, index) => (
              <TableRow key={parameter.uuid}>
                <TableCell>
                  <Input
                    key={index}
                    type="number"
                    min={1}
                    max={ordered.length}
                    defaultValue={index + 1}
                    aria-label={"Position of " + parameter.label}
                    className="h-7 w-20 font-mono"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        event.currentTarget.blur()
                      }
                    }}
                    onBlur={(event) => {
                      const target = Number(event.target.value) - 1
                      if (Number.isInteger(target) && target !== index)
                        move(index, Math.min(Math.max(target, 0), ordered.length - 1))
                      else event.target.value = String(index + 1)
                    }}
                  />
                </TableCell>
                <TableCell>{parameter.label}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {parameter.key}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {groupNames.get(parameter.parameter_group_uuid ?? "") ??
                    "Ungrouped"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={"Move " + parameter.label + " up"}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={"Move " + parameter.label + " down"}
                      disabled={index === ordered.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : !pageItems.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {filters ? "No matching parameters" : "No parameters yet"}
            </EmptyTitle>
            <EmptyDescription>
              {filters
                ? "Try a different search or group."
                : "Parameters are the values a device measures, reports or accepts."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parameter</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Stored unit</TableHead>
              <TableHead className="text-right">Decimals</TableHead>
              <TableHead>Validation</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.map(({ group: key, parameter }) => {
              if (!parameter) {
                const open = !collapsed.has(key)
                return (
                  <TableRow key={"group-" + key} className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={8}>
                      <button
                        type="button"
                        aria-expanded={open}
                        className="inline-flex items-center gap-2 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          const next = new Set(collapsed)
                          if (open) next.add(key)
                          else next.delete(key)
                          setCollapsed(next)
                        }}
                      >
                        <ChevronDownIcon
                          className={cn("size-4 text-muted-foreground", !open && "-rotate-90")}
                        />
                        {groupNames.get(key) ?? "Ungrouped"}
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                          {counts.get(key)}
                        </span>
                      </button>
                    </TableCell>
                  </TableRow>
                )
              }
              const precision = parameter.display_config?.precision
              return (
                <TableRow key={parameter.uuid}>
                  <TableCell className="max-w-72 truncate">
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => setEditing(parameter)}
                    >
                      {parameter.label}
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {parameter.key}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {kindLabel(parameter.kind)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {parameter.data_type}
                  </TableCell>
                  <TableCell className={cn(!parameter.unit && "text-muted-foreground")}>
                    {parameter.unit ?? "None"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {typeof precision === "number" ? precision : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {parameter.kind === "derived" ? (
                      <Link
                        className="text-primary hover:underline"
                        to={
                          "/organizations/" +
                          studio.org +
                          "/device-profiles/" +
                          profile.uuid +
                          "/calculations"
                        }
                      >
                        From calculation
                      </Link>
                    ) : (
                      ruleLabel(readValidation(jsonText(parameter.validation_logic)))
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={(canEdit ? "Edit " : "Inspect ") + parameter.label}
                        onClick={() => setEditing(parameter)}
                      >
                        <PencilIcon />
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={"Delete " + parameter.label}
                          disabled={studio.busy}
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
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {!order && pages > 1 && (
        <Pager page={shownPage} pages={pages} onPage={setPage} />
      )}
      <Accordion
        type="single"
        collapsible
        defaultValue={order?.kind === "groups" ? "groups" : undefined}
      >
        <AccordionItem value="groups">
          <AccordionTrigger>
            Manage parameter groups ({profile.parameter_groups.length})
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-3">
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
                  disabled={Boolean(order) || profile.parameter_groups.length < 2}
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
            {profile.parameter_groups.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Parameters</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(order?.kind === "groups"
                    ? order.ids.map(
                        (uuid) =>
                          profile.parameter_groups.find((item) => item.uuid === uuid)!,
                      )
                    : profile.parameter_groups
                  ).map((item, index, list) => (
                    <TableRow key={item.uuid}>
                      <TableCell title={item.description ?? undefined}>
                        {item.label}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.code}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {
                          profile.parameters.filter(
                            (parameter) => parameter.parameter_group_uuid === item.uuid,
                          ).length
                        }
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <div className="flex justify-end gap-1">
                            {order?.kind === "groups" ? (
                              <>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={"Move group " + item.label + " up"}
                                  disabled={!index}
                                  onClick={() => move(index, index - 1)}
                                >
                                  <ArrowUpIcon />
                                </Button>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={"Move group " + item.label + " down"}
                                  disabled={index === list.length - 1}
                                  onClick={() => move(index, index + 1)}
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {order && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 border bg-card p-3">
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
            ? "Its parameters move to Ungrouped. No parameters are deleted."
            : "This removes the parameter and its own calculation from the draft. Parameters used elsewhere can't be deleted. Published revisions don't change."
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
      description="Groups only organize parameters in this table."
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
