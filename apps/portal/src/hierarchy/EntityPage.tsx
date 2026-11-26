import { Fragment, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Entity, EntityMemberships, EntityPoint, PlacedDevice } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@iot-os/ui/components/breadcrumb"
import { Button } from "@iot-os/ui/components/button"
import { CopyButton, CopyText } from "@iot-os/ui/components/copy-text"
import { DataTable, RefLink, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Freshness, RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SegmentedControl, SegmentedControlItem } from "@iot-os/ui/components/segmented-control"
import { Status, StatusMark } from "@iot-os/ui/components/status-mark"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { EntityPage as EntityTemplate, PropertyList } from "@iot-os/ui/templates/entity-page"
import { EllipsisIcon, NetworkIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { Confirm, LoadError, RequestError } from "../components/forms"
import { devicePath, formatValue } from "../devices/shared"
import { utcOffset } from "../devices/TimezoneField"
import { EntityForm } from "./EntityForm"
import { EntityPicker } from "./EntityPicker"
import { EntityHistoryTab } from "./History"
import { MoveDialog } from "./MoveDialog"
import { allowedTypes, hierarchyPath, refreshHierarchy, useEntityTypes, useHierarchyOrganization } from "./shared"

const tabs = { points: "Points", devices: "Devices", history: "History", details: "Details" } as const
type Tab = keyof typeof tabs

/** One entity: its points, the devices placed in it, its history and its details (spec 009). */
export default function EntityRecord() {
  const { entityUuid = "", tab = "points" } = useParams()
  const { org, capabilities } = useHierarchyOrganization()
  const navigate = useNavigate()
  const client = useQueryClient()
  const current: Tab = tab in tabs ? (tab as Tab) : "points"
  const query = useQuery({ queryKey: ["entity", org, entityUuid], queryFn: () => api.entity(org, entityUuid), enabled: Boolean(org) })
  const types = useEntityTypes(org)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState(false)
  const [removing, setRemoving] = useState<"archive" | "delete" | null>(null)
  const entity = query.data
  const refresh = () => refreshHierarchy(client, org)
  const restore = useMutation({
    mutationFn: () => api.restoreEntity(org, entityUuid),
    onSuccess: async () => {
      await refresh()
      toast.success("Restored to the tree")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not restore it"),
  })

  if (query.error) return <LoadError error={query.error} what="this entity" />
  if (!entity)
    return (
      <EntityTemplate title="Entity" icon={<NetworkIcon />} back={{ to: hierarchyPath(org), label: "Hierarchy" }}>
        <p className="text-body text-muted-foreground">Loading…</p>
      </EntityTemplate>
    )

  const type = types.data?.data.find((candidate) => candidate.key === entity.type.key)
  const canAdd = capabilities.manage && !entity.archived_at && allowedTypes(types.data?.data ?? [], entity).length > 0
  return (
    <Tabs
      value={current}
      onValueChange={(value) => navigate(`${hierarchyPath(org, entity.uuid)}/${value}`)}
      activationMode="manual"
      className="gap-0"
    >
      <EntityTemplate
        title={entity.name}
        icon={<NetworkIcon />}
        code={entity.path}
        back={{ to: hierarchyPath(org), label: "Hierarchy" }}
        actions={
          capabilities.manage && (
            <>
              {canAdd && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <PlusIcon data-icon="inline-start" />
                  Add inside
                </Button>
              )}
              {entity.archived_at ? (
                <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate()}>
                  Restore
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="outline" aria-label={`More actions for ${entity.name}`}>
                      <EllipsisIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMoving(true)}>Move…</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setRemoving("archive")}>Archive</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemoving("delete")}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )
        }
        status={
          <>
            <Badge variant="outline">{entity.type.name}</Badge>
            {entity.archived_at && <StatusMark tone="muted">Archived</StatusMark>}
            {entity.outside_rules.length > 0 && <StatusMark tone="warning">Outside the rules</StatusMark>}
            <span className="text-muted-foreground">
              {entity.effective_timezone.replaceAll("_", " ")} · {utcOffset(entity.effective_timezone)}
            </span>
          </>
        }
        tabs={
          <TabsList variant="line" aria-label="Entity sections" className="justify-start px-1">
            {Object.entries(tabs).map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="flex-none">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        notices={
          <>
            <Trail org={org} entity={entity} />
            {entity.outside_rules.length > 0 && (
              <Alert>
                <AlertTitle>Outside the current rules</AlertTitle>
                <AlertDescription>
                  {entity.outside_rules.includes("parent_type") &&
                    `${type?.name ?? entity.type.name} is no longer allowed under its parent. `}
                  {entity.outside_rules.includes("naming") && "Its name no longer follows its type's naming template. "}
                  It keeps working; changes to it must follow the rules.
                </AlertDescription>
              </Alert>
            )}
          </>
        }
      >
        <TabsContent value={current} className="flex min-w-0 flex-col gap-(--panel-gap)">
          {current === "points" ? (
            <PointsTab org={org} entity={entity} />
          ) : current === "devices" ? (
            <DevicesTab org={org} entity={entity} />
          ) : current === "history" ? (
            <EntityHistoryTab org={org} entity={entity} />
          ) : (
            <DetailsTab org={org} entity={entity} canManage={capabilities.manage} />
          )}
        </TabsContent>
      </EntityTemplate>
      {editing && <EntityForm org={org} entity={entity} onClose={() => setEditing(false)} onSaved={() => void refresh()} />}
      {adding && (
        <EntityForm
          org={org}
          parent={entity}
          onClose={() => setAdding(false)}
          onSaved={async (child) => {
            await refresh()
            navigate(hierarchyPath(org, child.uuid))
          }}
        />
      )}
      {moving && (
        <MoveDialog
          org={org}
          entity={entity}
          onClose={() => setMoving(false)}
          onMoved={async (moved) => {
            await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["devices", org] })])
            toast.success(`Moved to ${moved.path}`)
          }}
        />
      )}
      <Confirm
        open={removing !== null}
        title={removing === "delete" ? `Delete ${entity.name}?` : `Archive ${entity.name}?`}
        description={
          removing === "delete"
            ? "Only an entity that never held anything can be deleted. Archive it to keep its history."
            : "It leaves the tree with everything below it. Devices placed in it are unplaced and keep their data. You can restore it later."
        }
        action={removing === "delete" ? "Delete" : "Archive"}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing === "delete") {
            await api.deleteEntity(org, entity.uuid)
            await refresh()
            navigate(hierarchyPath(org))
          } else {
            await api.archiveEntity(org, entity.uuid)
            await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["devices", org] })])
          }
          setRemoving(null)
        }}
      />
    </Tabs>
  )
}

/** Hierarchy / North / EastgateSS / Feeder12 */
function Trail({ org, entity }: { org: string; entity: Entity }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={hierarchyPath(org)}>Hierarchy</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {entity.ancestors.map((ancestor) => (
          <Fragment key={ancestor.uuid}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={hierarchyPath(org, ancestor.uuid)}>{ancestor.name}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        ))}
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{entity.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** Here only, or the whole branch with its members' branches. */
function Scope({ value, onChange }: { value: boolean; onChange: (branch: boolean) => void }) {
  return (
    <SegmentedControl
      aria-label="Which points"
      value={value ? "branch" : "here"}
      onValueChange={(next) => onChange(next === "branch")}
    >
      <SegmentedControlItem value="here">Here</SegmentedControlItem>
      <SegmentedControlItem value="branch">With everything below</SegmentedControlItem>
    </SegmentedControl>
  )
}

function PointsTab({ org, entity }: { org: string; entity: Entity }) {
  const [branch, setBranch] = useState(true)
  const [page, setPage] = useState(1)
  const points = useQuery({
    queryKey: ["entity", org, entity.uuid, "points", branch, page],
    queryFn: () => api.entityPoints(org, entity.uuid, { branch, page }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const columns = useMemo<DataColumn<EntityPoint>[]>(
    () => [
      {
        id: "point",
        header: "Point",
        mobile: "title",
        cell: (point) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{point.parameter.label || point.leaf_name}</span>
            <CopyText value={point.path} label={`Copy the path of ${point.leaf_name}`} mono className="truncate text-meta text-muted-foreground">
              {point.relative_path}
            </CopyText>
          </span>
        ),
      },
      {
        id: "value",
        header: "Value",
        align: "end",
        cell: (point) =>
          point.state === "name_clash" ? (
            <StatusMark tone="warning">Not placed: name clash</StatusMark>
          ) : point.state === "not_in_configuration" ? (
            <StatusMark tone="muted">Not in the configuration</StatusMark>
          ) : point.latest ? (
            <span className="tabular-nums">
              {formatValue(point.latest.value)}
              {point.parameter.unit && <span className="ml-1 text-muted-foreground">{point.parameter.unit}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">No value yet</span>
          ),
      },
      {
        id: "updated",
        header: "Updated",
        mobile: "meta",
        cell: (point) => <Freshness at={point.latest?.received_at ?? point.latest?.observed_at} never="Never" />,
      },
      {
        id: "device",
        header: "Device",
        mobile: "meta",
        cell: (point) => <RefLink to={devicePath(org, point.device.uuid)}>{point.device.name}</RefLink>,
      },
    ],
    [org],
  )
  return (
    <DataTable
      id="entity-points"
      label={`Points of ${entity.name}`}
      noun={["point", "points"]}
      rows={points.data?.data}
      rowKey={(point) => `${point.device.uuid}:${point.parameter.uuid}`}
      rowLabel={(point) => point.leaf_name}
      columns={columns}
      toolbar={
        <Scope
          value={branch}
          onChange={(next) => {
            setBranch(next)
            setPage(1)
          }}
        />
      }
      error={points.error ? <RequestError error={points.error} /> : undefined}
      refreshSeconds={30}
      rowActions={(point) => (
        <>
          <DropdownMenuItem asChild>
            <Link to={`${devicePath(org, point.device.uuid)}/data`}>Open history</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(point.path).then(() => toast.success("Path copied"))}>
            Copy path
          </DropdownMenuItem>
        </>
      )}
      pagination={{
        page,
        pageSize: points.data?.meta.per_page ?? 50,
        total: points.data?.meta.total ?? 0,
        pageCount: points.data?.meta.last_page,
        onPageChange: setPage,
      }}
      empty={
        <EmptyState
          inset
          title={branch ? "No points here or below" : "No points here"}
          description="Place a device here, or place single parameters from a device's Data tab."
        />
      }
    />
  )
}

function DevicesTab({ org, entity }: { org: string; entity: Entity }) {
  const [branch, setBranch] = useState(true)
  const [page, setPage] = useState(1)
  const devices = useQuery({
    queryKey: ["entity", org, entity.uuid, "devices", branch, page],
    queryFn: () => api.entityDevices(org, entity.uuid, { branch, page }),
    placeholderData: keepPreviousData,
  })
  const columns = useMemo<DataColumn<PlacedDevice>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        mobile: "title",
        cell: (device) => <RowLink to={devicePath(org, device.uuid)}>{device.name}</RowLink>,
      },
      { id: "code", header: "Code", cell: (device) => <span className="font-mono text-code">{device.code}</span> },
      { id: "lifecycle", header: "Lifecycle", mobile: "badge", cell: (device) => <Status value={device.lifecycle} /> },
      {
        id: "place",
        header: "Placed at",
        cell: (device) =>
          device.entity.uuid === entity.uuid ? (
            <span className="text-muted-foreground">Here</span>
          ) : (
            <RefLink to={hierarchyPath(org, device.entity.uuid)}>{device.entity.path}</RefLink>
          ),
      },
    ],
    [org, entity.uuid],
  )
  return (
    <DataTable
      id="entity-devices"
      label={`Devices in ${entity.name}`}
      noun={["device", "devices"]}
      rows={devices.data?.data}
      rowKey={(device) => device.uuid}
      rowLabel={(device) => device.name}
      rowHref={(device) => devicePath(org, device.uuid)}
      columns={columns}
      toolbar={
        <>
          <Scope
            value={branch}
            onChange={(next) => {
              setBranch(next)
              setPage(1)
            }}
          />
          <Button asChild size="sm" variant="outline">
            <Link to={`${devicePath(org)}?entity=${encodeURIComponent(entity.uuid)}`}>Open in Devices</Link>
          </Button>
        </>
      }
      error={devices.error ? <RequestError error={devices.error} /> : undefined}
      pagination={{
        page,
        pageSize: devices.data?.meta.per_page ?? 25,
        total: devices.data?.meta.total ?? 0,
        pageCount: devices.data?.meta.last_page,
        onPageChange: setPage,
      }}
      empty={
        <EmptyState
          inset
          title="No devices placed here"
          description="Choose this place on a device's page, or move a device here from the Devices list."
        />
      }
    />
  )
}

function DetailsTab({ org, entity, canManage }: { org: string; entity: Entity; canManage: boolean }) {
  const location =
    entity.latitude !== null && entity.longitude !== null ? `${entity.latitude}, ${entity.longitude}` : null
  return (
    <div className="grid items-start gap-(--panel-gap) xl:grid-cols-2">
      <Panel>
        <PanelHeader>
          <PanelTitle>Details</PanelTitle>
        </PanelHeader>
        <PanelContent>
          <PropertyList
            items={[
              { label: "Type", value: entity.type.name },
              {
                label: "Path",
                value: (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="font-mono text-code break-all">{entity.path}</span>
                    <CopyButton value={entity.path} label="Copy the path" />
                  </span>
                ),
              },
              { label: "Path name", value: <span className="font-mono text-code">{entity.path_name}</span> },
              ...(entity.description ? [{ label: "Description", value: entity.description }] : []),
              {
                label: "Time zone",
                value: entity.timezone
                  ? entity.timezone.replaceAll("_", " ")
                  : `${entity.effective_timezone.replaceAll("_", " ")} (from above)`,
              },
              ...(entity.address ? [{ label: "Address", value: entity.address }] : []),
              ...(location ? [{ label: "Location", value: location }] : []),
              ...(entity.updated_at ? [{ label: "Changed", value: <RelativeTime at={entity.updated_at} /> }] : []),
            ]}
          />
        </PanelContent>
      </Panel>
      <MembershipsPanel org={org} entity={entity} canManage={canManage} />
    </div>
  )
}

/** Groups across the tree (FR-023): what this entity is a member of, and who its members are. */
function MembershipsPanel({ org, entity, canManage }: { org: string; entity: Entity; canManage: boolean }) {
  const client = useQueryClient()
  const types = useEntityTypes(org)
  const memberships = useQuery({
    queryKey: ["entity", org, entity.uuid, "memberships"],
    queryFn: () => api.entityMemberships(org, entity.uuid),
  })
  const [group, setGroup] = useState("")
  const [leaving, setLeaving] = useState<EntityMemberships["groups"][number] | null>(null)
  const groupTypes = new Set(
    (types.data?.data ?? []).filter((type) => type.member_type_keys.includes(entity.type.key)).map((type) => type.key),
  )
  const refresh = () =>
    Promise.all([client.invalidateQueries({ queryKey: ["entity", org] }), client.invalidateQueries({ queryKey: ["devices", org] })])
  const join = useMutation({
    mutationFn: (uuid: string) => api.joinGroup(org, entity.uuid, uuid),
    onSuccess: async (joined) => {
      setGroup("")
      await refresh()
      toast.success(`${entity.name} is now a member of ${joined.group.name}`)
    },
  })
  const current = memberships.data?.groups.filter((row) => !row.ended_at) ?? []
  const members = memberships.data?.members.filter((row) => !row.ended_at) ?? []
  const past = [
    ...(memberships.data?.groups.filter((row) => row.ended_at).map((row) => ({ ...row, other: row.group, as: "member of" })) ?? []),
    ...(memberships.data?.members.filter((row) => row.ended_at).map((row) => ({ ...row, other: row.member, as: "held" })) ?? []),
  ]
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Groups</PanelTitle>
        <PanelDescription className="text-body">
          A group covers its members' devices and points without moving them.
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <RequestError error={memberships.error ?? join.error} />
        <section aria-label="Member of" className="flex flex-col gap-2">
          <h3 className="text-meta font-medium text-muted-foreground">Member of</h3>
          {current.length ? (
            <ul className="flex flex-col gap-1">
              {current.map((row) => (
                <li key={row.group.uuid} className="flex items-center justify-between gap-2">
                  <RefLink to={hierarchyPath(org, row.group.uuid)}>{row.group.path}</RefLink>
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setLeaving(row)}>
                      Leave
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No groups.</p>
          )}
          {canManage && !entity.archived_at && groupTypes.size > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <EntityPicker
                org={org}
                label="Join a group"
                value={group}
                onChange={(uuid) => setGroup(uuid)}
                accept={(candidate) => groupTypes.has(candidate.type.key) && candidate.uuid !== entity.uuid}
                placeholder="Choose a group"
                help="Joining another group of the same type ends the current one."
                className="min-w-64 flex-1"
              />
              <Button size="sm" disabled={!group || join.isPending} onClick={() => join.mutate(group)}>
                Join
              </Button>
            </div>
          )}
        </section>
        {members.length > 0 && (
          <section aria-label="Members" className="flex flex-col gap-2">
            <h3 className="text-meta font-medium text-muted-foreground">Members</h3>
            <ul className="flex flex-col gap-1">
              {members.map((row) => (
                <li key={row.member.uuid}>
                  <RefLink to={hierarchyPath(org, row.member.uuid)}>{row.member.path}</RefLink>
                </li>
              ))}
            </ul>
          </section>
        )}
        {past.length > 0 && (
          <section aria-label="Earlier" className="flex flex-col gap-2">
            <h3 className="text-meta font-medium text-muted-foreground">Earlier</h3>
            <ul className="flex flex-col gap-1 text-body text-muted-foreground">
              {past.map((row) => (
                <li key={`${row.as}:${row.other.uuid}:${row.started_at}`}>
                  {row.as === "member of" ? "Member of" : "Held"} {row.other.path}
                  {row.ended_at && (
                    <>
                      {" "}
                      until <RelativeTime at={row.ended_at} />
                    </>
                  )}
                  {row.end_reason === "replaced" && " (replaced)"}
                </li>
              ))}
            </ul>
          </section>
        )}
      </PanelContent>
      <Confirm
        open={Boolean(leaving)}
        title={`Leave ${leaving?.group.name ?? "the group"}?`}
        description={`${leaving?.group.name ?? "The group"} stops covering ${entity.name}'s devices and points.`}
        action="Leave"
        onClose={() => setLeaving(null)}
        onConfirm={async () => {
          if (!leaving) return
          await api.leaveGroup(org, entity.uuid, leaving.group.uuid)
          await refresh()
          setLeaving(null)
        }}
      />
    </Panel>
  )
}
