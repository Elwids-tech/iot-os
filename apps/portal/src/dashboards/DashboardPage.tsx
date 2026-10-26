import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "react-router-dom"
import { LockIcon } from "lucide-react"
import { ApiError, type DashboardCapabilities } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { useDashboardCapabilities } from "./access"
import { dashboardPath, withCompactLayouts } from "./model"
import { DashboardWorkspace } from "./DashboardWorkspace"
import { DashboardLibrary } from "./LibraryPage"
import { rememberDashboardPlace } from "./lastPlace"

export function DashboardPage({ org, id }: { org: string; id?: string }) {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: 60000,
  })
  const capabilities = useDashboardCapabilities(org)
  // Acknowledging alerts in the context rail is a device action, not a dashboard one.
  const canManageDevices =
    session.data?.organizations.find((o) => o.uuid === org)?.capabilities
      ?.devices?.manage ?? false
  const viewer = session.data?.id
  // The library is a place too: back at the list, Dashboards in the sidebar opens the list.
  useEffect(() => {
    if (viewer !== undefined && !id) rememberDashboardPlace(viewer, org, null)
  }, [viewer, org, id])
  if (session.data && !capabilities.view)
    return (
      <>
        <PageHeader title="Dashboards" />
        <div className="p-4 md:p-6">
          <EmptyState
            icon={<LockIcon />}
            title="You can't open dashboards"
            description="Ask an organization admin for dashboard access."
          />
        </div>
      </>
    )
  return id ? (
    <DashboardDetail key={org + id} org={org} id={id} viewer={viewer} capabilities={capabilities} canManageDevices={canManageDevices} />
  ) : (
    <DashboardLibrary key={org} org={org} capabilities={capabilities} />
  )
}

function DashboardDetail({
  org,
  id,
  viewer,
  capabilities,
  canManageDevices,
}: {
  org: string
  id: string
  viewer?: number
  capabilities: DashboardCapabilities
  canManageDevices: boolean
}) {
  // Refetch on focus so other people's saves show up; the edit draft is kept
  // and a stale save still gets the 409 conflict flow.
  const query = useQuery({
    queryKey: ["dashboard", org, id],
    queryFn: () => api.dashboard(org, id),
    // Older dashboards may keep gaps from free placement; the editor works on the layout as drawn.
    select: withCompactLayouts,
    refetchOnWindowFocus: true,
    retry: (count, error) => !(error instanceof ApiError && error.status === 403) && count < 2,
  })
  const { search } = useLocation()
  const gone = query.error instanceof ApiError && [403, 404].includes(query.error.status)
  // Remember this dashboard and its view; one that is gone or no longer shared falls back to the library.
  useEffect(() => {
    if (viewer === undefined) return
    if (query.data) rememberDashboardPlace(viewer, org, id, search)
    else if (gone) rememberDashboardPlace(viewer, org, null)
  }, [viewer, org, id, search, Boolean(query.data), gone])
  if (query.data)
    return (
      <DashboardWorkspace org={org} saved={query.data} capabilities={capabilities} canManageDevices={canManageDevices} />
    )
  const denied = query.error instanceof ApiError && query.error.status === 403
  return (
    <>
      <PageHeader
        title="Dashboard"
        back={{ to: dashboardPath(org), label: "Dashboards" }}
      />
      <div className="flex flex-col items-start gap-4 p-4 md:p-6">
        {query.isPending ? (
          <Skeleton className="h-80 w-full" />
        ) : denied ? (
          <EmptyState
            className="w-full"
            icon={<LockIcon />}
            title="You don't have access to this dashboard"
            description="It is shared with specific people and roles. Ask its owner to share it with you."
          />
        ) : (
          <>
            <RequestError error={query.error} />
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry dashboard
            </Button>
          </>
        )}
      </div>
    </>
  )
}
