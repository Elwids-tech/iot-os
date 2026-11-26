import { useId, useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { BranchAtRow, Entity, HistoryEvent } from "@iot-os/api-client"
import {
  ActivityChanges,
  ActivityDay,
  ActivityItem,
  ActivityTimeline,
  groupByDay,
} from "@iot-os/ui/components/activity-timeline"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { HistoryIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError, TextField } from "../components/forms"
import { localInput } from "../adapters/source"
import { devicePath } from "../devices/shared"
import { endReasonText } from "./model"
import { hierarchyPath } from "./shared"

type Page = { data: HistoryEvent[]; meta: { current_page: number; last_page: number } }

/** An entity's or a device's history, newest first, a page of 50 at a time. */
function useHistory(key: unknown[], load: (page: number) => Promise<Page>) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => load(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
  })
}

/**
 * The timeline itself. `here` is the entity whose page shows it, so its own name is left
 * out ("Pump 1 placed here"); without it the events read from the device's side.
 */
export function HistoryTimeline({
  org,
  history,
  here,
  empty,
}: {
  org: string
  history: ReturnType<typeof useHistory>
  here?: string
  empty: ReactNode
}) {
  const events = useMemo(() => history.data?.pages.flatMap((page) => page.data) ?? [], [history.data])
  const dated = events.filter((event) => event.at !== null)
  const undated = events.filter((event) => event.at === null)
  if (history.isPending)
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    )
  if (history.error) return <RequestError error={history.error} />
  if (events.length === 0) return <>{empty}</>
  const days = groupByDay(dated, (event) => event.at!)
  return (
    <div className="flex flex-col gap-4">
      <ActivityTimeline>
        {days.map((day) => (
          <ActivityDay key={day.key} label={day.label}>
            {day.items.map((event) => (
              <HistoryEntry key={event.id} org={org} event={event} here={here} />
            ))}
          </ActivityDay>
        ))}
        {!history.hasNextPage && undated.length > 0 && (
          <ActivityDay label="Before history was kept">
            {undated.map((event) => (
              <HistoryEntry key={event.id} org={org} event={event} here={here} />
            ))}
          </ActivityDay>
        )}
      </ActivityTimeline>
      {history.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Loading…" : "Load older history"}
        </Button>
      ) : (
        <p className="text-center text-meta text-muted-foreground">That is everything recorded.</p>
      )}
    </div>
  )
}

function HistoryEntry({ org, event, here }: { org: string; event: HistoryEvent; here?: string }) {
  const place = (entity: HistoryEvent["entity"], fallback = "the top level") =>
    entity ? (
      entity.uuid === here ? (
        "here"
      ) : (
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={hierarchyPath(org, entity.uuid)}>
          {entity.name}
        </Link>
      )
    ) : (
      fallback
    )
  const device = event.device ? (
    <Link className="font-medium underline-offset-4 hover:underline" to={devicePath(org, event.device.uuid)}>
      {event.device.name}
    </Link>
  ) : (
    "A deleted device"
  )
  const ended = endReasonText(event.end_reason)
  const point = event.parameter ? <span className="font-mono text-code">{event.parameter.leaf_name}</span> : null
  const sentence: Record<HistoryEvent["kind"], ReactNode> = {
    created: <>Created under {place(event.new_parent ?? null)}</>,
    moved: (
      <>
        Moved from {place(event.old_parent ?? null)} to {place(event.new_parent ?? null)}
      </>
    ),
    renamed: <>Path name changed</>,
    retyped: <>Type changed</>,
    archived: <>Archived</>,
    restored: <>Restored</>,
    device_placed: here ? <>{device} placed here</> : <>Placed at {place(event.entity ?? null)}</>,
    device_removed: here ? (
      <>
        {device} left{ended && `: ${ended}`}
      </>
    ) : (
      <>
        Left {place(event.entity ?? null)}
        {ended && `: ${ended}`}
      </>
    ),
    point_placed: here ? (
      <>
        {device}’s {event.parameter?.key} placed here as {point}
      </>
    ) : (
      <>
        {event.parameter?.key} placed on its own at {place(event.entity ?? null)} as {point}
      </>
    ),
    point_removed: here ? (
      <>
        {device}’s {point} left{ended && `: ${ended}`}
      </>
    ) : (
      <>
        {event.parameter?.key} left {place(event.entity ?? null)}
        {ended && `: ${ended}`}
      </>
    ),
    joined_group: <>Joined {place(event.group ?? null)}</>,
    left_group: (
      <>
        Left {place(event.group ?? null)}
        {ended && ended !== "left" && `: ${ended}`}
      </>
    ),
    member_added: <>{place(event.member ?? null)} joined</>,
    member_removed: (
      <>
        {place(event.member ?? null)} left{ended && ended !== "left" && `: ${ended}`}
      </>
    ),
  }
  const changes =
    event.kind === "renamed"
      ? [{ label: "Path name", from: event.old_path_name ?? null, to: event.new_path_name ?? null }]
      : event.kind === "retyped"
        ? [{ label: "Type", from: event.old_type?.name ?? null, to: event.new_type?.name ?? null }]
        : []
  const path =
    !here && event.entity
      ? `${event.entity.path}${event.parameter ? `/${event.parameter.leaf_name}` : ""}`
      : undefined
  return (
    <ActivityItem
      actor={event.user?.name ?? null}
      at={event.at}
      meta={
        <>
          <span>{event.user?.name ?? (event.at ? "System" : "Placed before history was kept")}</span>
          {path && <span className="font-mono text-code break-all">{path}</span>}
        </>
      }
      changes={changes.length ? <ActivityChanges changes={changes} /> : undefined}
    >
      {sentence[event.kind]}
    </ActivityItem>
  )
}

/** The History tab of an entity: what happened to it, and what was in it at a past time. */
export function EntityHistoryTab({ org, entity }: { org: string; entity: Entity }) {
  const history = useHistory(["entity", org, entity.uuid, "history"], (page) => api.entityHistory(org, entity.uuid, page))
  const title = useId()
  return (
    <div className="grid items-start gap-(--panel-gap) xl:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]">
      <Panel aria-labelledby={title}>
        <PanelHeader>
          <PanelTitle id={title}>History</PanelTitle>
          <PanelDescription>Moves, renames, devices and points placed here, and groups. Paths are as they are today.</PanelDescription>
        </PanelHeader>
        <PanelContent>
          <HistoryTimeline
            org={org}
            history={history}
            here={entity.uuid}
            empty={<EmptyState inset icon={<HistoryIcon />} title="No history yet" description="Changes to this entity appear here." />}
          />
        </PanelContent>
      </Panel>
      <BranchAt org={org} entity={entity} />
    </div>
  )
}

/** Devices and points in the branch at a chosen time, using the tree as it was then. */
function BranchAt({ org, entity }: { org: string; entity: Entity }) {
  const [time, setTime] = useState("")
  const [page, setPage] = useState(1)
  const title = useId()
  const at = time ? new Date(time) : null
  const valid = at !== null && !Number.isNaN(at.getTime())
  const future = valid && at.getTime() > Date.now()
  const rows = useQuery({
    queryKey: ["entity", org, entity.uuid, "branch-at", time, page],
    queryFn: () => api.entityBranchAt(org, entity.uuid, at!.toISOString(), page),
    enabled: valid && !future,
    placeholderData: keepPreviousData,
  })
  const columns = useMemo<DataColumn<BranchAtRow>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        mobile: "title",
        cell: (row) => <RowLink to={devicePath(org, row.device.uuid)}>{row.device.name}</RowLink>,
      },
      {
        id: "what",
        header: "What",
        mobile: "badge",
        cell: (row) =>
          row.kind === "device" ? (
            <span className="text-muted-foreground">Whole device</span>
          ) : (
            <span className="font-mono text-code">{row.leaf_name}</span>
          ),
      },
      {
        id: "place",
        header: "Placed at",
        cell: (row) =>
          row.entity === null ? (
            <span className="text-muted-foreground">Deleted</span>
          ) : row.entity.uuid === entity.uuid ? (
            <span className="text-muted-foreground">Here</span>
          ) : (
            <RefLink to={hierarchyPath(org, row.entity.uuid)}>{row.entity.path}</RefLink>
          ),
      },
      {
        id: "since",
        header: "Since",
        cell: (row) =>
          row.started_at ? <RelativeTime at={row.started_at} /> : <span className="text-muted-foreground">Before history</span>,
      },
    ],
    [org, entity.uuid],
  )
  return (
    <Panel aria-labelledby={title}>
      <PanelHeader>
        <PanelTitle id={title}>What was here</PanelTitle>
        <PanelDescription>
          The devices and points in {entity.name} and below it at a past time, as the tree was then.
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="As of"
            type="datetime-local"
            value={time}
            max={localInput(Date.now())}
            onChange={(event) => {
              setTime(event.target.value)
              setPage(1)
            }}
            error={future ? "Choose a time that has passed." : undefined}
            className="w-auto"
          />
          <Button type="button" variant="outline" size="sm" className="mb-0.5" onClick={() => setTime(localInput(Date.now()))}>
            Now
          </Button>
        </div>
        {!valid || future ? (
          <p className="text-body text-muted-foreground">Choose a time to see what was placed here then.</p>
        ) : rows.data?.meta.existed === false ? (
          <EmptyState inset title={`${entity.name} did not exist yet`} description="Choose a later time." />
        ) : (
          <DataTable
            id="entity-branch-at"
            label={`${entity.name} as of the chosen time`}
            noun={["placement", "placements"]}
            rows={rows.data?.data}
            rowKey={(row) => `${row.kind}:${row.device.uuid}:${row.leaf_name ?? ""}:${row.started_at ?? ""}`}
            rowLabel={(row) => (row.kind === "device" ? row.device.name : `${row.device.name} ${row.leaf_name}`)}
            columns={columns}
            filtered
            error={rows.error ? <RequestError error={rows.error} /> : undefined}
            pagination={{
              page,
              pageSize: rows.data?.meta.per_page ?? 50,
              total: rows.data?.meta.total ?? 0,
              pageCount: rows.data?.meta.last_page,
              onPageChange: setPage,
            }}
            empty={<EmptyState inset title="Nothing was placed here then" description="Try another time." />}
          />
        )}
      </PanelContent>
    </Panel>
  )
}

/** A device's places over time: its placements and its parameters placed on their own. */
export function DevicePlaceHistory({ org, device }: { org: string; device: { uuid: string; name: string } }) {
  const history = useHistory(["device", org, device.uuid, "place-history"], (page) => api.devicePlaceHistory(org, device.uuid, page))
  return (
    <HistoryTimeline
      org={org}
      history={history}
      empty={
        <EmptyState
          inset
          icon={<HistoryIcon />}
          title="Never placed"
          description={`${device.name} has not been placed in the hierarchy yet.`}
        />
      }
    />
  )
}
