import { useQuery } from "@tanstack/react-query"
import { Button } from "@iot-os/ui/components/button"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { dashboardPath, withCompactLayouts } from "./model"
import { DashboardWorkspace } from "./DashboardWorkspace"
import { DashboardLibrary } from "./LibraryPage"

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
    <DashboardLibrary key={org} org={org} canManage={canManage} />
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
  // Refetch on focus so other people's saves show up; the edit draft is kept
  // and a stale save still gets the 409 conflict flow.
  const query = useQuery({
    queryKey: ["dashboard", org, id],
    queryFn: () => api.dashboard(org, id),
    // Older dashboards may keep gaps from free placement; the editor works on the layout as drawn.
    select: withCompactLayouts,
    refetchOnWindowFocus: true,
  })
  if (query.data)
    return (
      <DashboardWorkspace org={org} saved={query.data} canManage={canManage} />
    )
  return (
    <>
      <PageHeader
        title="Dashboard"
        back={{ to: dashboardPath(org), label: "Dashboards" }}
      />
      <div className="flex flex-col items-start gap-4 p-4 md:p-6">
        {query.isPending ? (
          <Skeleton className="h-80 w-full" />
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
