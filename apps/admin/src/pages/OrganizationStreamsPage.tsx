import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import type { IntegrationStreamSession } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { AlertCircleIcon, RadioIcon } from "lucide-react"
import { apiClient } from "../lib/api-client"

const back = { to: "/organizations", label: "Organizations" }

/** How often the list is read again; the relay touches a session every 30 s. */
const REFRESH_MS = 30_000

/** The organization's open application telemetry streams (spec 030): who is streaming, since when, and how far. */
export function OrganizationStreamsPage() {
  const { organizationUuid = "" } = useParams()
  const [streams, setStreams] = useState<IntegrationStreamSession[] | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(() => {
    let active = true
    apiClient
      .adminOrganizationIntegrationStreams(organizationUuid)
      .then((data) => {
        if (!active) return
        setStreams(data)
        setLoadError(false)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [organizationUuid])

  useEffect(() => {
    const cancel = load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      cancel()
      window.clearInterval(timer)
    }
  }, [load])

  const columns = useMemo<DataColumn<IntegrationStreamSession>[]>(
    () => [
      {
        id: "application",
        header: "Application",
        mobile: "title",
        value: (stream) => stream.application.name,
        cell: (stream) => <span className="font-medium">{stream.application.name}</span>,
      },
      {
        id: "opened",
        header: "Opened",
        value: (stream) => stream.opened_at,
        cell: (stream) => <RelativeTime at={stream.opened_at} />,
      },
      {
        id: "seen",
        header: "Last seen",
        value: (stream) => stream.last_seen_at,
        cell: (stream) => <RelativeTime at={stream.last_seen_at} />,
      },
      {
        id: "devices",
        header: "Devices",
        align: "end",
        summary: "sum",
        value: (stream) => stream.device_count,
        cell: (stream) => <span className="tabular-nums">{stream.device_count.toLocaleString()}</span>,
      },
      {
        id: "position",
        header: "Last position",
        align: "end",
        value: (stream) => stream.last_position ?? "",
        cell: (stream) =>
          stream.last_position === null ? (
            <span className="text-muted-foreground">No reading yet</span>
          ) : (
            <span className="font-mono text-code tabular-nums">{stream.last_position}</span>
          ),
      },
    ],
    [],
  )

  return (
    <>
      <PageHeader title="Telemetry streams" back={back} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {loadError ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not load the open streams</AlertTitle>
            <AlertDescription>The list is read again every 30 seconds.</AlertDescription>
          </Alert>
        ) : null}
        <Panel>
          <PanelHeader>
            <PanelTitle>Open streams</PanelTitle>
            <PanelDescription>
              Each open stream holds one API worker for up to an hour; the limits are 2 per application, 10 per
              organization and the deployment&apos;s cap. A stream unseen for 90 seconds no longer counts.
            </PanelDescription>
          </PanelHeader>
          <PanelContent>
            <DataTable
              id="admin-organization-streams"
              label="Open telemetry streams"
              noun={["stream", "streams"]}
              rowKey={(stream) => String(stream.id)}
              rowLabel={(stream) => stream.application.name}
              columns={columns}
              rows={streams}
              defaultSort={[{ id: "opened", desc: false }]}
              empty={
                <EmptyState
                  inset
                  icon={<RadioIcon />}
                  title="No open streams"
                  description="Applications with the telemetry:stream ability appear here while they follow their devices."
                />
              }
            />
          </PanelContent>
        </Panel>
      </div>
    </>
  )
}
