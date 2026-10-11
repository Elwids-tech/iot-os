import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { SparkplugConnection } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Status } from "@iot-os/ui/components/status-mark"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { CableIcon, PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { Confirm, RequestError } from "../components/forms"
import { GatewayEditor } from "./GatewaysPage"
import { useDeviceOrganization } from "./shared"

/** Broker connections: the groups gateways publish into. */
export function ConnectionsPage() {
  const { org, capabilities } = useDeviceOrganization()
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [provision, setProvision] = useState<SparkplugConnection | null>(null)
  const connections = useQuery({
    queryKey: ["connections", org, page],
    queryFn: () => api.connectionsPage(org, { page, per_page: 25 }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const columns: DataColumn<SparkplugConnection>[] = [
    { id: "connection", header: "Connection", mobile: "title", value: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      className: "whitespace-normal",
      value: (c) => c.status,
      cell: (c) => (
        <div className="flex flex-col items-start gap-1">
          <Status value={c.status} />
          {c.diagnostic && <p className="max-w-sm text-meta text-muted-foreground">{c.diagnostic}</p>}
          {capabilities.connections && c.status !== "ready" && (
            <Button variant="outline" size="sm" onClick={() => setProvision(c)}>
              {c.status === "failed" ? "Retry provisioning" : "Provision"}
            </Button>
          )}
        </div>
      ),
    },
    {
      id: "group",
      header: "Group ID",
      hidden: true,
      mobile: "hidden",
      value: (c) => c.group_id,
      cell: (c) => <code className="font-mono text-code text-muted-foreground">{c.group_id}</code>,
    },
  ]
  return (
    <CollectionPage
      title="Connections"
      description="Broker groups that gateways publish into. A gateway needs a ready connection."
      actions={
        capabilities.connections && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" />
            Add connection
          </Button>
        )
      }
    >
      <DataTable
        id="broker-connections"
        label="Broker connections"
        noun={["connection", "connections"]}
        rows={connections.data?.data}
        rowKey={(c) => c.uuid}
        rowLabel={(c) => c.name}
        columns={columns}
        error={connections.error ? <RequestError error={connections.error} /> : undefined}
        pagination={{
          page,
          pageSize: 25,
          total: connections.data?.meta?.total ?? 0,
          pageCount: connections.data?.meta?.last_page,
          onPageChange: setPage,
        }}
        refreshSeconds={5}
        empty={
          <EmptyState
            inset
            icon={<CableIcon />}
            title="No broker connections yet"
            description={capabilities.connections ? "Add a connection to reserve a group on the broker." : undefined}
          />
        }
      />
      {adding && (
        <GatewayEditor
          kind="connection"
          org={org}
          connections={[]}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            await connections.refetch()
            setAdding(false)
          }}
        />
      )}
      <Confirm
        open={Boolean(provision)}
        title={`Provision ${provision?.name ?? "this connection"}?`}
        description="Creates the broker user and topic rules for this group. A retry reuses the saved records."
        action={provision?.status === "failed" ? "Retry provisioning" : "Provision"}
        destructive={false}
        onClose={() => setProvision(null)}
        onConfirm={async () => {
          if (provision) await api.provisionConnection(org, provision.uuid)
          await connections.refetch()
        }}
      />
    </CollectionPage>
  )
}
