import { useId, useState, type FormEvent, type ReactNode } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ApiError,
  type Dashboard,
  type DashboardInput,
  type Device,
} from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { CircleAlertIcon } from "lucide-react"
import { api } from "../lib/api"
import { Choice, fieldError, RequestError, TextField } from "../components/forms"
import { DEFAULT_VIEW } from "./model"
import {
  definition,
  FILE_TOO_LARGE,
  fieldLabel,
  MAX_IMPORT_BYTES,
  parseDefinitions,
} from "./importExport"
import {
  panelLabel,
  profilePanels,
  withLayout,
  type DashboardTemplate,
} from "./templates"

/** Dialog with a form body; Cancel and the submit button sit in the footer. */
function FormDialog({
  title,
  submit,
  busy,
  disabled,
  onSubmit,
  onClose,
  wide,
  children,
}: {
  title: string
  submit: string
  busy: boolean
  disabled?: boolean
  onSubmit: () => Promise<void>
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className={wide ? "max-h-[90dvh] overflow-y-auto sm:max-w-2xl" : undefined}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!busy && !disabled) void onSubmit()
          }}
        >
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || disabled}>
              {busy ? "Working…" : submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Runs `action`, keeping its error for display and a busy flag while it runs. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (issue) {
      setError(issue)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function FolderField({
  value,
  onChange,
  folders,
  error,
}: {
  value: string
  onChange: (value: string) => void
  folders: string[]
  error?: string
}) {
  const list = useId()
  return (
    <>
      <TextField
        label="Folder"
        list={list}
        maxLength={60}
        value={value}
        error={error}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={list}>
        {folders.map((folder) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>
    </>
  )
}

export function BlankDialog({
  org,
  onClose,
  onCreated,
}: {
  org: string
  onClose: () => void
  onCreated: (dashboard: Dashboard) => Promise<void>
}) {
  const [name, setName] = useState("")
  const { busy, error, run } = useAction()
  return (
    <FormDialog
      title="New dashboard"
      submit="Create dashboard"
      busy={busy}
      disabled={!name.trim()}
      onClose={onClose}
      onSubmit={() =>
        run(async () =>
          onCreated(
            await api.createDashboard(org, {
              name: name.trim(),
              widgets: [],
              layouts: {},
              defaults: DEFAULT_VIEW,
            }),
          ),
        )
      }
    >
      <TextField
        label="Dashboard name"
        autoFocus
        required
        maxLength={120}
        value={name}
        error={fieldError(error, "name")}
        onChange={(e) => setName(e.target.value)}
      />
      <RequestError error={fieldError(error, "name") ? null : error} />
    </FormDialog>
  )
}

/** Comma-separated tags, trimmed, without case-insensitive repeats (the server does the same). */
function tagList(text: string) {
  const tags: string[] = []
  for (const tag of text.split(",").map((t) => t.trim()))
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag)
  return tags
}

/** Rename, tags and folder through the regular update with the current revision. */
export function SettingsDialog({
  org,
  dashboard,
  folders,
  folderOnly,
  onReload,
  onClose,
}: {
  org: string
  dashboard: Dashboard
  folders: string[]
  folderOnly: boolean
  onReload: () => Promise<unknown>
  onClose: () => void
}) {
  const cache = useQueryClient()
  const [name, setName] = useState(dashboard.name)
  const [tags, setTags] = useState(dashboard.tags.join(", "))
  const [folder, setFolder] = useState(dashboard.folder ?? "")
  const { busy, error, run } = useAction()
  const list = tagList(tags)
  const tagIssue =
    list.length > 10
      ? "Use up to 10 tags."
      : list.some((tag) => tag.length > 32)
        ? "Keep each tag to 32 characters or fewer."
        : undefined
  const conflict = error instanceof ApiError && error.status === 409
  return (
    <FormDialog
      title={folderOnly ? `Move ${dashboard.name}` : "Dashboard settings"}
      submit={folderOnly ? "Move" : "Save settings"}
      busy={busy}
      disabled={!name.trim() || Boolean(tagIssue)}
      onClose={onClose}
      onSubmit={() =>
        run(async () => {
          const saved = await api.updateDashboard(org, dashboard.uuid, {
            ...definition(dashboard),
            name: name.trim(),
            tags: list,
            folder: folder.trim() || null,
            revision: dashboard.revision,
          })
          cache.setQueryData<Dashboard[]>(["dashboards", org], (all) =>
            all?.map((d) => (d.uuid === saved.uuid ? saved : d)),
          )
          cache.setQueryData(["dashboard", org, saved.uuid], saved)
          toast.success(folderOnly ? "Moved" : "Settings saved")
          onClose()
        })
      }
    >
      {!folderOnly && (
        <>
          <TextField
            label="Dashboard name"
            required
            maxLength={120}
            value={name}
            error={fieldError(error, "name")}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Tags"
            placeholder="energy, line 2"
            value={tags}
            error={tagIssue ?? fieldError(error, "tags")}
            onChange={(e) => setTags(e.target.value)}
          />
        </>
      )}
      <FolderField
        value={folder}
        onChange={setFolder}
        folders={folders}
        error={fieldError(error, "folder")}
      />
      {conflict ? (
        <Alert>
          <AlertDescription className="flex flex-col items-start gap-2">
            This dashboard changed since the list loaded. Reload, then save
            again. Your changes here are kept.
            <Button type="button" size="sm" variant="outline" onClick={onReload}>
              Reload dashboards
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        !fieldError(error, "name") &&
        !fieldError(error, "folder") && <RequestError error={error} />
      )}
    </FormDialog>
  )
}

export function DuplicateDialog({
  org,
  dashboard,
  onClose,
}: {
  org: string
  dashboard: Dashboard
  onClose: () => void
}) {
  const cache = useQueryClient()
  const [name, setName] = useState(`${dashboard.name} copy`)
  const { busy, error, run } = useAction()
  return (
    <FormDialog
      title={`Duplicate ${dashboard.name}`}
      submit="Duplicate"
      busy={busy}
      disabled={!name.trim()}
      onClose={onClose}
      onSubmit={() =>
        run(async () => {
          const copy = await api.duplicateDashboard(org, dashboard.uuid, name.trim())
          await cache.invalidateQueries({ queryKey: ["dashboards", org] })
          toast.success(`Created ${copy.name}`)
          onClose()
        })
      }
    >
      <TextField
        label="Name of the copy"
        autoFocus
        required
        maxLength={120}
        value={name}
        error={fieldError(error, "name")}
        onChange={(e) => setName(e.target.value)}
      />
      <RequestError error={fieldError(error, "name") ? null : error} />
    </FormDialog>
  )
}

/** Server validation errors listed per field, with panel numbers and titles. */
function ServerErrors({
  error,
  title,
  widgets,
}: {
  error: unknown
  title: string
  widgets?: DashboardInput["widgets"]
}) {
  const errors =
    error instanceof ApiError && error.status === 422
      ? (error.payload as { errors?: Record<string, string[]> } | null)?.errors
      : undefined
  if (!errors) return <RequestError error={error} />
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {Object.entries(errors).map(([field, messages]) => (
            <li key={field}>
              <span className="font-medium">{fieldLabel(field, widgets)}</span>:{" "}
              {messages.join(" ")}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

export function ImportDialog({
  org,
  onClose,
  onCreated,
}: {
  org: string
  onClose: () => void
  onCreated: (dashboards: Dashboard[]) => Promise<unknown>
}) {
  const cache = useQueryClient()
  const id = useId()
  const [parsed, setParsed] = useState<ReturnType<typeof parseDefinitions> | null>(null)
  const [failed, setFailed] = useState<DashboardInput>()
  const { busy, error, setError, run } = useAction()
  const definitions = parsed?.definitions ?? []
  return (
    <FormDialog
      title="Import dashboard"
      submit={definitions.length > 1 ? `Import ${definitions.length} dashboards` : "Import"}
      busy={busy}
      disabled={!definitions.length}
      onClose={onClose}
      onSubmit={() =>
        run(async () => {
          const created: Dashboard[] = []
          for (const [index, input] of definitions.entries()) {
            try {
              created.push(await api.createDashboard(org, input))
            } catch (issue) {
              // Drop the ones already created so importing again does not duplicate them.
              setParsed({ definitions: definitions.slice(index), errors: [] })
              setFailed(input)
              if (created.length)
                await cache.invalidateQueries({ queryKey: ["dashboards", org] })
              throw issue
            }
          }
          await onCreated(created)
        })
      }
    >
      <Field>
        <FieldLabel htmlFor={id}>JSON file</FieldLabel>
        <Input
          id={id}
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            setError(null)
            setFailed(undefined)
            // Checked before reading so a huge file never reaches JSON.parse.
            setParsed(
              !file
                ? null
                : file.size > MAX_IMPORT_BYTES
                  ? { definitions: [], errors: [FILE_TOO_LARGE] }
                  : parseDefinitions(await file.text()),
            )
          }}
        />
      </Field>
      {parsed?.errors.length ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>This file cannot be imported</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {parsed.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        definitions.length > 0 && (
          <ul aria-label="Dashboards in the file" className="divide-y border-y text-sm">
            {definitions.map((d, index) => (
              <li key={index} className="flex gap-2 py-1.5">
                <span className="min-w-0 truncate font-medium">{d.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                  {d.widgets.length} {d.widgets.length === 1 ? "panel" : "panels"}
                </span>
              </li>
            ))}
          </ul>
        )
      )}
      {error !== null && (
        <ServerErrors
          error={error}
          title={`${failed?.name ?? "The dashboard"} was not imported`}
          widgets={failed?.widgets}
        />
      )}
    </FormDialog>
  )
}

type ListedDevice = Device & {
  profile?: { uuid: string; name: string; revision: number } | null
}

async function allDevices(org: string) {
  const devices: ListedDevice[] = []
  // ponytail: reads up to 20 pages of 25; add a profile filter to the device list API when orgs outgrow it.
  for (let page = 1; page <= 20; page++) {
    const result = await api.devices(org, { page })
    devices.push(...result.data)
    if (page >= result.meta.last_page) break
  }
  return devices
}

/** Template or device profile: pick devices, preview the generated panels, create. */
export function GenerateDialog({
  org,
  template,
  folders,
  onClose,
  onCreated,
}: {
  org: string
  template?: DashboardTemplate
  folders: string[]
  onClose: () => void
  onCreated: (dashboard: Dashboard) => Promise<void>
}) {
  const devices = useQuery({
    queryKey: ["dashboard-library-devices", org],
    queryFn: () => allDevices(org),
    staleTime: 30000,
  })
  const [profile, setProfile] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [excluded, setExcluded] = useState<string[]>([])
  const [name, setName] = useState(template?.name ?? "")
  const [folder, setFolder] = useState("")
  const { busy, error, run } = useAction()

  const profiles = new Map<string, string>()
  for (const d of devices.data ?? [])
    if (d.profile) profiles.set(d.profile.uuid, d.profile.name)
  const candidates = (devices.data ?? []).filter(
    (d) => template || (profile && d.profile?.uuid === profile),
  )
  const needle = search.trim().toLowerCase()
  const shown = candidates.filter(
    (d) =>
      !needle ||
      d.name.toLowerCase().includes(needle) ||
      d.code.toLowerCase().includes(needle),
  )
  const details = useQueries({
    queries: picked.map((id) => ({
      queryKey: ["dashboard-device", org, id],
      queryFn: () => api.device(org, id),
      staleTime: 30000,
    })),
  })
  // Group labels come from the profile's authoring view; without access, panels are ungrouped.
  const groups = useQuery({
    queryKey: ["dashboard-profile-groups", org, profile],
    queryFn: () => api.deviceProfile(org, profile),
    enabled: !template && Boolean(profile),
    retry: false,
    staleTime: 60000,
  })
  const detailError = details.find((q) => q.error)?.error
  const ready =
    picked.length > 0 &&
    details.every((q) => q.data) &&
    (Boolean(template) || !groups.isLoading)
  const loaded = details.flatMap((q) => (q.data ? [q.data] : []))
  const panels = !ready
    ? []
    : template
      ? template.build(loaded)
      : profilePanels(loaded, (uuid) => {
          const group = groups.data?.parameters.find((p) => p.uuid === uuid)
            ?.parameter_group_uuid
          return groups.data?.parameter_groups.find((g) => g.uuid === group)?.label
        })
  const chosen = panels.filter((p) => !excluded.includes(p.id))

  return (
    <FormDialog
      wide
      title={template ? `New dashboard from ${template.name}` : "New dashboard from device profile"}
      submit="Create dashboard"
      busy={busy}
      disabled={!chosen.length || !name.trim()}
      onClose={onClose}
      onSubmit={() =>
        run(async () =>
          onCreated(
            await api.createDashboard(org, {
              name: name.trim(),
              ...withLayout(chosen),
              defaults: DEFAULT_VIEW,
              tags: [],
              folder: folder.trim() || null,
            }),
          ),
        )
      }
    >
      <RequestError error={devices.error} />
      {!template && (
        <Choice
          label="Device profile"
          value={profile}
          disabled={devices.isPending}
          options={[
            { value: "", label: devices.isPending ? "Loading profiles…" : "Choose a profile" },
            ...[...profiles].map(([value, label]) => ({ value, label })),
          ]}
          onChange={(next) => {
            setProfile(next)
            const first = devices.data?.find((d) => d.profile?.uuid === next)
            setPicked(first ? [first.uuid] : [])
            setExcluded([])
            setName(next ? `${profiles.get(next)} overview` : "")
          }}
        />
      )}
      {(template || profile) && (
        <FieldSet>
          <FieldLegend variant="label">
            Devices <span className="text-muted-foreground tabular-nums">{picked.length}</span>
          </FieldLegend>
          {candidates.length > 8 && (
            <Input
              type="search"
              aria-label="Search devices"
              placeholder="Search devices"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {devices.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {shown.map((d) => (
                <li key={d.uuid}>
                  <label className="flex h-8 items-center gap-2 rounded-sm px-1 text-sm hover:bg-muted/50">
                    <Checkbox
                      checked={picked.includes(d.uuid)}
                      onCheckedChange={(checked) =>
                        setPicked((list) =>
                          checked === true ? [...list, d.uuid] : list.filter((id) => id !== d.uuid),
                        )
                      }
                    />
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                      {d.code}
                    </span>
                  </label>
                </li>
              ))}
              {!shown.length && (
                <li className="py-2 text-sm text-muted-foreground">
                  {candidates.length ? "No matching devices" : "No devices yet"}
                </li>
              )}
            </ul>
          )}
        </FieldSet>
      )}
      {picked.length > 0 && (
        <FieldSet>
          <FieldLegend variant="label">
            Panels <span className="text-muted-foreground tabular-nums">{chosen.length}</span>
          </FieldLegend>
          <RequestError error={detailError} />
          {!ready ? (
            !detailError && <Skeleton className="h-20 w-full" />
          ) : panels.length ? (
            <ul aria-label="Generated panels" className="flex flex-col gap-0.5">
              {panels.map((p) => {
                const n = p.config.devices?.length ?? p.config.sources.length
                return (
                  <li key={p.id}>
                    <label className="flex h-8 items-center gap-2 rounded-sm px-1 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={!excluded.includes(p.id)}
                        onCheckedChange={(checked) =>
                          setExcluded((list) =>
                            checked === true ? list.filter((id) => id !== p.id) : [...list, p.id],
                          )
                        }
                      />
                      <span className="w-28 shrink-0 text-muted-foreground">
                        {panelLabel(p.type)}
                      </span>
                      <span className="truncate">{p.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {n} {p.config.devices ? "devices" : n === 1 ? "value" : "values"}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {template
                ? `No matching parameters. This template needs ${template.needs.toLowerCase()}.`
                : "The chosen devices have no applied configuration."}
            </p>
          )}
        </FieldSet>
      )}
      <FieldGroup className="sm:grid sm:grid-cols-2">
        <TextField
          label="Dashboard name"
          required
          maxLength={120}
          value={name}
          error={fieldError(error, "name")}
          onChange={(e) => setName(e.target.value)}
        />
        <FolderField value={folder} onChange={setFolder} folders={folders} />
      </FieldGroup>
      {error !== null && !fieldError(error, "name") && (
        <ServerErrors error={error} title="Dashboard not created" widgets={chosen} />
      )}
    </FormDialog>
  )
}
