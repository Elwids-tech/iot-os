import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, type Dashboard } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format"
import { api } from "../lib/api"
import { Confirm, RequestError } from "../components/forms"
import { panelLabel } from "./templates"

/**
 * Revision list with a panel preview and Restore. Mount it inside a sheet.
 * `onRestored` receives the restored dashboard, or the latest one when the
 * person reloads after a conflict; the parent should show it as the saved dashboard.
 */
export function VersionHistory({
  org,
  dashboard,
  revision,
  canManage,
  onRestored,
}: {
  org: string
  dashboard: string
  revision: number
  canManage: boolean
  onRestored: (next: Dashboard) => void
}) {
  const cache = useQueryClient()
  const list = useQuery({
    queryKey: ["dashboard-revisions", org, dashboard, revision],
    queryFn: () => api.dashboardRevisions(org, dashboard),
  })
  const [selected, setSelected] = useState<number | null>(null)
  const preview = useQuery({
    queryKey: ["dashboard-revision", org, dashboard, selected],
    queryFn: () => api.dashboardRevision(org, dashboard, selected ?? 0),
    enabled: selected !== null,
    // Snapshots never change.
    staleTime: Infinity,
  })
  const [restore, setRestore] = useState<number | null>(null)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [reloadError, setReloadError] = useState<unknown>(null)

  function adopt(next: Dashboard) {
    cache.setQueryData(["dashboard", org, dashboard], next)
    void cache.invalidateQueries({ queryKey: ["dashboards", org] })
    onRestored(next)
  }

  if (list.isPending) return <Skeleton className="h-48 w-full" />
  if (list.error)
    return (
      <div className="flex flex-col gap-3">
        <RequestError error={list.error} />
        <Button variant="outline" onClick={() => list.refetch()}>
          Retry versions
        </Button>
      </div>
    )
  return (
    <div className="flex flex-col gap-3">
      {conflict && (
        <Alert>
          <AlertDescription className="flex flex-col items-start gap-2">
            This dashboard changed since you opened it. Reload it, then choose
            the version to restore.
            <RequestError error={reloadError} />
            <Button
              size="sm"
              variant="outline"
              disabled={reloading}
              onClick={async () => {
                setReloading(true)
                setReloadError(null)
                try {
                  adopt(await api.dashboard(org, dashboard))
                  setConflict(false)
                } catch (error) {
                  setReloadError(error)
                } finally {
                  setReloading(false)
                }
              }}
            >
              {reloading ? "Reloading…" : "Reload dashboard"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <ul aria-label="Versions" className="divide-y border-y">
        {list.data.map((item) => {
          const open = selected === item.revision
          return (
            <li key={item.revision} className="py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-expanded={open}
                  className="min-w-0 flex-1 rounded-sm px-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelected(open ? null : item.revision)}
                >
                  <span className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono tabular-nums">
                      v{item.revision}
                    </span>
                    <span className="truncate font-medium">{item.name}</span>
                    <time
                      className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
                      dateTime={item.created_at}
                      title={formatDateTime(item.created_at)}
                    >
                      {formatAge(item.created_at)} ago
                    </time>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {item.widget_count}{" "}
                    {item.widget_count === 1 ? "panel" : "panels"}
                    {item.updated_by_name && ` · ${item.updated_by_name}`}
                    {item.revision === revision && " · Current"}
                  </span>
                </button>
                {canManage && item.revision !== revision && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Restore version ${item.revision}`}
                    onClick={() => setRestore(item.revision)}
                  >
                    Restore
                  </Button>
                )}
              </div>
              {open && (
                <div className="px-1 pt-2">
                  {preview.isPending ? (
                    <Skeleton className="h-16 w-full" />
                  ) : preview.error ? (
                    <RequestError error={preview.error} />
                  ) : preview.data.widgets.length ? (
                    <ul
                      aria-label={`Panels in version ${item.revision}`}
                      className="flex flex-col gap-1 text-sm"
                    >
                      {preview.data.widgets.map((widget) => (
                        <li key={widget.id} className="flex gap-2">
                          <span className="w-28 shrink-0 text-muted-foreground">
                            {panelLabel(widget.type)}
                          </span>
                          <span className="min-w-0 truncate">
                            {widget.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No panels</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <Confirm
        open={restore !== null}
        title={`Restore version ${restore}?`}
        description="It is saved as a new version. Newer versions stay in history."
        action="Restore version"
        destructive={false}
        onClose={() => setRestore(null)}
        onConfirm={async () => {
          if (restore === null) return
          try {
            adopt(
              await api.restoreDashboardRevision(
                org,
                dashboard,
                restore,
                revision,
              ),
            )
            setConflict(false)
          } catch (error) {
            if (error instanceof ApiError && error.status === 409)
              setConflict(true)
            else throw error
          }
        }}
      />
    </div>
  )
}
