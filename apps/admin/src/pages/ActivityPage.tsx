import { useEffect, useState } from "react"
import type {
  ActivityEvent,
  ActivityFieldChange,
  DirectoryQuery,
  Organization,
  PaginatedResponse,
  PlatformUser,
} from "@iot-os/api-client"
import {
  ActivityChanges,
  ActivityDay,
  ActivityItem,
  ActivityTimeline,
  groupByDay,
} from "@iot-os/ui/components/activity-timeline"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FilterBar } from "@iot-os/ui/components/filter-bar"
import { Panel, PanelContent } from "@iot-os/ui/components/panel"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { ScrollTextIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { useSearchOptions } from "../hooks/use-search-options"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"

function loadPeople(query: DirectoryQuery): Promise<PaginatedResponse<PlatformUser>> {
  return apiClient.adminUsers(query)
}

function loadOrganizations(query: DirectoryQuery): Promise<PaginatedResponse<Organization>> {
  return apiClient.adminOrganizations(query)
}

/** "display_name" → "Display name". */
function fieldLabel(field: string) {
  const words = field.replace(/[_.]+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function changeRows(changes: ActivityFieldChange[]) {
  return changes.map((change) => ({ label: fieldLabel(change.field), from: change.from, to: change.to, opaque: change.opaque }))
}

type Feed = {
  events: ActivityEvent[]
  next: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
}

/**
 * The activity log (spec 024): what people changed in the portal and the admin app,
 * newest first, filtered by person and organization. Filters live in the address
 * (`?user=7&organization=<uuid>`), so a filtered view can be shared or reloaded.
 */
export function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const userParam = params.get("user")
  const userId = userParam && /^\d+$/.test(userParam) ? Number(userParam) : undefined
  const organization = params.get("organization") ?? undefined
  const people = useSearchOptions(loadPeople)
  const organizations = useSearchOptions(loadOrganizations)
  // Names for the selectors when the filters come from the address: the options may not
  // include them, so they are taken from the first matching event.
  const [labels, setLabels] = useState<{ user?: string; organization?: string }>({})
  const [feed, setFeed] = useState<Feed>({ events: [], next: null, loading: true, loadingMore: false, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setFeed({ events: [], next: null, loading: true, loadingMore: false, error: null })
    apiClient
      .adminActivity({ userId, organization })
      .then((page) => {
        if (!active) return
        setFeed({ events: page.data, next: page.meta.next_cursor, loading: false, loadingMore: false, error: null })
        const first = page.data[0]
        if (first) {
          setLabels((current) => ({
            user: userId ? (current.user ?? first.actor.name ?? undefined) : undefined,
            organization: organization ? (current.organization ?? first.organization?.name) : undefined,
          }))
        }
      })
      .catch((reason: unknown) => {
        if (active) setFeed({ events: [], next: null, loading: false, loadingMore: false, error: errorMessage(reason) })
      })
    return () => {
      active = false
    }
  }, [userId, organization, attempt])

  const loadOlder = () => {
    if (!feed.next || feed.loadingMore) return
    setFeed((current) => ({ ...current, loadingMore: true }))
    apiClient
      .adminActivity({ userId, organization, cursor: feed.next })
      .then((page) =>
        setFeed((current) => ({ ...current, events: [...current.events, ...page.data], next: page.meta.next_cursor, loadingMore: false })),
      )
      .catch((reason: unknown) =>
        setFeed((current) => ({ ...current, loadingMore: false, error: errorMessage(reason) })),
      )
  }

  const filter = (key: "user" | "organization", value: string, label?: string) => {
    setLabels((current) => ({ ...current, [key]: value ? label : undefined }))
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const filtered = Boolean(userId || organization)
  const days = groupByDay(feed.events, (event) => event.at)

  return (
    <CollectionPage title="Activity" description="What people changed in the portal and the admin app, newest first.">
      <FilterBar>
        <SearchableSelect
          label="Person"
          labelHidden
          className="w-full sm:w-64"
          value={userId ? String(userId) : ""}
          selectedLabel={userId ? labels.user : undefined}
          placeholder="Everyone"
          emptyText={people.failed ? "People could not be loaded." : "No one matches."}
          {...people.select}
          options={[
            { value: "", label: "Everyone" },
            ...people.items.map((person) => ({ value: String(person.id), label: `${person.name} · ${person.email}` })),
          ]}
          onChange={(value) => filter("user", value, people.items.find((person) => String(person.id) === value)?.name)}
        />
        <SearchableSelect
          label="Organization"
          labelHidden
          className="w-full sm:w-64"
          value={organization ?? ""}
          selectedLabel={organization ? labels.organization : undefined}
          placeholder="All organizations"
          emptyText={organizations.failed ? "Organizations could not be loaded." : "No organization matches."}
          {...organizations.select}
          options={[
            { value: "", label: "All organizations" },
            ...organizations.items.map((item) => ({ value: item.uuid, label: item.name })),
          ]}
          onChange={(value) => filter("organization", value, organizations.items.find((item) => item.uuid === value)?.name)}
        />
        {filtered ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        ) : null}
      </FilterBar>
      <Panel>
        <PanelContent>
          {feed.loading ? (
            <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading activity">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex gap-3">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : feed.error && feed.events.length === 0 ? (
            <EmptyState
              inset
              icon={<ScrollTextIcon />}
              title="Activity could not be loaded"
              description={feed.error}
              action={
                <Button type="button" variant="outline" onClick={() => setAttempt((current) => current + 1)}>
                  Try again
                </Button>
              }
            />
          ) : feed.events.length === 0 ? (
            <EmptyState
              inset
              icon={<ScrollTextIcon />}
              title={filtered ? "No activity matches these filters" : "No activity yet"}
              description={
                filtered
                  ? "Nobody matching these filters has changed anything that is recorded."
                  : "Changes people make in the portal and the admin app appear here."
              }
              action={
                filtered ? (
                  <Button type="button" variant="outline" onClick={() => setParams({}, { replace: true })}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              <ActivityTimeline>
                {days.map((day) => (
                  <ActivityDay key={day.key} label={day.label}>
                    {day.items.map((event) => (
                      <ActivityEntry key={event.id} event={event} />
                    ))}
                  </ActivityDay>
                ))}
              </ActivityTimeline>
              {feed.error ? <p className="text-meta text-destructive">{feed.error}</p> : null}
              {feed.next ? (
                <Button type="button" variant="outline" className="self-center" onClick={loadOlder} disabled={feed.loadingMore}>
                  {feed.loadingMore ? "Loading…" : "Load older activity"}
                </Button>
              ) : (
                <p className="text-center text-meta text-muted-foreground">That is everything recorded.</p>
              )}
            </div>
          )}
        </PanelContent>
      </Panel>
    </CollectionPage>
  )
}

function ActivityEntry({ event }: { event: ActivityEvent }) {
  const actor = event.actor.name
  const details = event.details.filter((detail) => detail.value !== "")

  return (
    <ActivityItem
      actor={actor}
      at={event.at}
      meta={
        event.organization ? (
          <Badge variant="outline" asChild>
            <Link to={`/activity?organization=${encodeURIComponent(event.organization.uuid)}`}>{event.organization.name}</Link>
          </Badge>
        ) : (
          <Badge variant="secondary">Platform</Badge>
        )
      }
      changes={
        event.changes.length || details.length ? (
          <>
            <ActivityChanges changes={changeRows(event.changes)} />
            {details.length ? (
              <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
                {details.map((detail) => (
                  <span key={detail.key} className="min-w-0 break-words">
                    {fieldLabel(detail.key)}: <span className="text-foreground">{detail.value}</span>
                  </span>
                ))}
              </p>
            ) : null}
          </>
        ) : undefined
      }
    >
      <span className="font-medium" title={event.actor.email ?? undefined}>
        {actor ?? "Deleted user"}
      </span>{" "}
      <span className="text-muted-foreground">{event.summary}</span>
      {event.subject?.name ? (
        <>
          {" "}
          <span className="font-medium">{event.subject.name}</span>
        </>
      ) : null}
    </ActivityItem>
  )
}
