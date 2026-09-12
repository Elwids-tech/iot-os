import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { LayoutDashboardIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { dashboardPath, DEFAULT_VIEW, timeLabel } from "./model"
import { DashboardWorkspace } from "./DashboardWorkspace"

export function DashboardPage({ org, id }: { org: string; id?: string }) {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: 60000,
  })
  const canManage =
    session.data?.organizations.find((o) => o.uuid === org)?.capabilities
      ?.devices?.manage ?? false
  return id ? (
    <DashboardDetail key={org + id} org={org} id={id} canManage={canManage} />
  ) : (
    <DashboardDirectory key={org} org={org} canManage={canManage} />
  )
}

function DashboardDirectory({
  org,
  canManage,
}: {
  org: string
  canManage: boolean
}) {
  const query = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
  })
  const cache = useQueryClient(),
    navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [create, setCreate] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const dashboards = (query.data ?? []).filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboards</h1>
          <p className="text-muted-foreground">
            Build a focused view for each site, process, or team.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setCreate(true)
              setName("")
              setError(null)
            }}
          >
            <PlusIcon data-icon="inline-start" />
            Create dashboard
          </Button>
        )}
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="dashboard-search">Search dashboards</FieldLabel>
          <Input
            id="dashboard-search"
            type="search"
            placeholder="Find a dashboard…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
      </FieldGroup>
      <RequestError error={query.error} />
      {query.error && (
        <Button variant="outline" onClick={() => query.refetch()}>
          Retry dashboards
        </Button>
      )}
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : dashboards.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((d) => (
            <Card key={d.uuid}>
              <CardHeader>
                <LayoutDashboardIcon className="text-muted-foreground" />
                <CardTitle>{d.name}</CardTitle>
                <CardDescription>
                  {d.widgets.length}{" "}
                  {d.widgets.length === 1 ? "panel" : "panels"} ·
                  Organization-shared
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Updated {timeLabel(d.updated_at, "browser")}
                </p>
              </CardContent>
              <CardFooter>
                <Button asChild variant="outline">
                  <Link to={dashboardPath(org, d.uuid)}>Open dashboard</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        !query.error && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {search
                  ? "No matching dashboards"
                  : "Your dashboards start here"}
              </EmptyTitle>
              <EmptyDescription>
                {search
                  ? "Try another name."
                  : "Create multiple dashboards, each with its own panels, layout, and time settings."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      )}
      <Dialog open={create} onOpenChange={(open) => !saving && setCreate(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create dashboard</DialogTitle>
            <DialogDescription>
              Choose a name. You can add panels and rename it later.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!name.trim()) return
              setSaving(true)
              setError(null)
              try {
                const created = await api.createDashboard(org, {
                  name: name.trim(),
                  widgets: [],
                  layouts: {},
                  defaults: DEFAULT_VIEW,
                })
                cache.setQueryData(["dashboard", org, created.uuid], created)
                await cache.invalidateQueries({
                  queryKey: ["dashboards", org],
                })
                setCreate(false)
                navigate(dashboardPath(org, created.uuid), {
                  state: { edit: true },
                })
              } catch (issue) {
                setError(issue)
              } finally {
                setSaving(false)
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-dashboard-name">
                  Dashboard name
                </FieldLabel>
                <Input
                  id="new-dashboard-name"
                  autoFocus
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>
            </FieldGroup>
            <RequestError error={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setCreate(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Creating…" : "Create dashboard"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DashboardDetail({
  org,
  id,
  canManage,
}: {
  org: string
  id: string
  canManage: boolean
}) {
  const query = useQuery({
    queryKey: ["dashboard", org, id],
    queryFn: () => api.dashboard(org, id),
    refetchOnWindowFocus: false,
  })
  if (query.isPending) return <Skeleton className="h-80 w-full" />
  if (!query.data || query.error)
    return (
      <div className="flex flex-col gap-4">
        <RequestError error={query.error} />
        <Button variant="outline" onClick={() => query.refetch()}>
          Retry dashboard
        </Button>
        <Link to={dashboardPath(org)}>Back to dashboards</Link>
      </div>
    )
  return (
    <DashboardWorkspace org={org} saved={query.data} canManage={canManage} />
  )
}
