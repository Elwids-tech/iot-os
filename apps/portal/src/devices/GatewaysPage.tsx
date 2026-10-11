import { Status } from "@iot-os/ui/components/status-mark"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { Fragment, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import type {
  Device,
  Gateway,
  SparkplugConnection,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@iot-os/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  ChevronDownIcon,
  CopyIcon,
  PlusIcon,
  RouterIcon,
} from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  Choice,
  Confirm,
  TextField,
  RequestError,
  EditorSheet,
  SaveBar,
} from "../components/forms"
import { connectionsPath, discoveryPath, gatewayPath, useDeviceOrganization } from "./shared"

export function GatewaysPage() {
  const { org, capabilities } = useDeviceOrganization()
  const [params] = useSearchParams()
  const legacy = params.get("gateway")
  const [page, setPage] = useState(1),
    [connectionPage, setConnectionPage] = useState(1),
    [search, setSearch] = useState("")
  const gateways = useQuery({
    queryKey: ["gateways", org, page, search],
    queryFn: () => api.gatewaysPage(org, { page, search, per_page: 25 }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const connections = useQuery({
    queryKey: ["connections", org, connectionPage],
    queryFn: () =>
      api.connectionsPage(org, { page: connectionPage, per_page: 25 }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  // Devices per gateway come from the device list; each device carries its source's gateway.
  const devices = useQuery({
    queryKey: ["devices", org, "all"],
    queryFn: async () => {
      const all: Device[] = []
      for (let next = 1, last = 1; next <= last; next++) {
        const result = await api.devices(org, { page: next, per_page: 100 })
        all.push(...result.data)
        last = result.meta.last_page
      }
      return all
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  })
  const byGateway = new Map<string, Device[]>()
  for (const device of devices.data ?? [])
    if (device.candidate)
      byGateway.set(device.candidate.gateway.uuid, [
        ...(byGateway.get(device.candidate.gateway.uuid) ?? []),
        device,
      ])
  const [editor, setEditor] = useState<"connection" | "gateway" | null>(null),
    [error, setError] = useState<unknown>(null),
    [provision, setProvision] = useState<
      | { kind: "gateway"; item: Gateway }
      | { kind: "connection"; item: SparkplugConnection }
      | null
    >(null),
    [credentials, setCredentials] = useState<Gateway | null>(null)
  const ready = connections.data?.data.some((c) => c.status === "ready")
  // Links from before the gateway page used ?gateway=; send them to the page.
  if (legacy) return <Navigate to={gatewayPath(org, legacy)} replace />
  const gatewayColumns: DataColumn<Gateway>[] = [
    {
      id: "gateway",
      header: "Gateway",
      mobile: "title",
      value: (g) => g.name,
      cell: (g) => (
<RowLink to={gatewayPath(org, g.uuid)}>{g.name}</RowLink>
      ),
    },
    { id: "presence", header: "Presence", mobile: "badge", value: (g) => g.presence, cell: (g) => <Status value={g.presence} /> },
    {
      id: "sources",
      header: "Sources",
      value: (g) => g.sources_count,
      cell: (g) => (
        <RefLink to={discoveryPath(org, g.uuid)}>
          {g.sources_count === 1 ? "1 source" : `${g.sources_count} sources`}
        </RefLink>
      ),
    },
    {
      id: "devices",
      header: "Devices",
      align: "end",
      summary: "sum",
      value: (g) => (devices.data ? (byGateway.get(g.uuid)?.length ?? 0) : null),
      cell: (g) => <span className="tabular-nums">{devices.data ? (byGateway.get(g.uuid)?.length ?? 0) : ""}</span>,
    },
    { id: "last-seen", header: "Last seen", align: "end", value: (g) => g.last_seen_at, cell: (g) => <RelativeTime at={g.last_seen_at} /> },
  ]
  return (
    <>
      <CollectionPage
        title="Gateways"
        actions={
          capabilities.connections && (
            <>
              <Button size="sm" onClick={() => setEditor("gateway")} disabled={!ready}>
                <PlusIcon data-icon="inline-start" />
                Register gateway
              </Button>
            </>
          )
        }
        notices={
          <>
            <RequestError error={error} />
            {capabilities.connections && connections.data && !ready && (
              <p className="text-body text-muted-foreground">
                Register gateway needs a ready broker connection. Add one under{" "}
                <Link className="text-foreground underline underline-offset-4" to={connectionsPath(org)}>
                  Connections
                </Link>
                .
              </p>
            )}
          </>
        }
      >
        <div className="flex min-w-0 flex-col gap-8">
          <DataTable
            id="gateways"
            label="Gateways"
            noun={["gateway", "gateways"]}
            rows={gateways.data?.data}
            rowKey={(g) => g.uuid}
            rowLabel={(g) => g.name}
            rowHref={(g) => gatewayPath(org, g.uuid)}
            columns={gatewayColumns}
            error={gateways.error ? <RequestError error={gateways.error} /> : undefined}
            search={{
              label: "Find a gateway",
              placeholder: "Search gateways by name",
              value: search,
              onChange: (value) => {
                setSearch(value)
                setPage(1)
              },
            }}
            filtered={Boolean(search)}
            pagination={{
              page,
              pageSize: 25,
              total: gateways.data?.meta.total ?? 0,
              pageCount: gateways.data?.meta.last_page,
              onPageChange: setPage,
            }}
            rowActions={(g) => (
              <>
                {capabilities.connections && (
                  <DropdownMenuItem onSelect={() => setProvision({ kind: "gateway", item: g })}>
                    Apply gateway access
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link to={discoveryPath(org, g.uuid)}>Open in discovery</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCredentials(g)}>Get credentials</DropdownMenuItem>
              </>
            )}
            refreshSeconds={5}
            empty={
              <EmptyState
                inset
                icon={<RouterIcon />}
                title="No gateways yet"
                description="Add a broker connection and register a gateway. Its credentials come from a CLI export on the server, never from this page."
              />
            }
          />
        </div>
      </CollectionPage>
      {editor && (
        <GatewayEditor
          kind={editor}
          org={org}
          connections={(connections.data?.data ?? [])
            .filter((c) => c.status === "ready")
            .map((c) => ({ value: c.uuid, label: c.name }))}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            await Promise.all([gateways.refetch(), connections.refetch()])
            setEditor(null)
          }}
        />
      )}
      <Confirm
        open={Boolean(provision)}
        title={
          provision?.kind === "gateway"
            ? `Apply access for ${provision.item.name}?`
            : `Provision ${provision?.item.name ?? "this connection"}?`
        }
        description={
          provision?.kind === "gateway"
            ? "Writes the gateway's broker user and topic rules. The gateway keeps its credentials; this does not connect it."
            : "Creates the broker user and topic rules for this group. A retry reuses the saved records."
        }
        action={
          provision?.kind === "gateway"
            ? "Apply access"
            : provision?.item.status === "failed"
              ? "Retry provisioning"
              : "Provision"
        }
        destructive={false}
        onClose={() => setProvision(null)}
        onConfirm={async () => {
          setError(null)
          if (provision?.kind === "gateway") {
            await api.provisionGateway(org, provision.item.uuid)
            await gateways.refetch()
          } else if (provision) {
            await api.provisionConnection(org, provision.item.uuid)
            await connections.refetch()
          }
        }}
      />
      {credentials && <GatewayCredentials gateway={credentials} onClose={() => setCredentials(null)} />}
    </>
  )
}

/** How an operator exports a gateway's credentials; the portal never shows them. */
export function GatewayCredentials({ gateway, onClose }: { gateway: Gateway; onClose: () => void }) {
  return (
  <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Get gateway credentials</DialogTitle>
        <DialogDescription>
          The portal never shows credentials. An operator with server access
          exports them to a new file from the API container:
        </DialogDescription>
      </DialogHeader>
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
        php artisan devices:export-gateway {gateway.uuid} --output=/tmp/gateway.json
        --broker=ssl://BROKER_HOST:8883 --ca=/path/on/gateway/ca.crt
      </pre>
      <p className="text-sm text-muted-foreground">
        Use the broker address and CA path the gateway can reach, then install
        the file and the CA certificate on the gateway.
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  )
}

/** Broker identifiers for support, collapsed by default and copyable. */
export function TechnicalDetails({
  rows,
  className,
}: {
  rows: Array<{ label: string; value: string; name?: string }>
  className?: string
}) {
  const [copied, setCopied] = useState("")
  async function copy(name: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(`${name} copied`)
    } catch {
      setCopied("Copying is unavailable here. Select the text instead.")
    }
  }
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group -ml-2 text-muted-foreground"
        >
          Technical details
          <ChevronDownIcon
            data-icon="inline-end"
            className="transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-1 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
          {rows.map((row) => (
            <Fragment key={row.label + row.value}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-mono text-xs break-all select-all">{row.value}</dd>
              <dd>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Copy ${row.name ?? row.label}`}
                  onClick={() => void copy(row.name ?? row.label, row.value)}
                >
                  <CopyIcon />
                </Button>
              </dd>
            </Fragment>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground" role="status">
          {copied}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function GatewayEditor({
  kind,
  org,
  connections,
  onClose,
  onSaved,
}: {
  kind: "connection" | "gateway"
  org: string
  connections: Array<{ value: string; label: string }>
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const form = useForm({
      defaultValues: { name: "", identifier: "", connection: "" },
    }),
    [error, setError] = useState<unknown>(null)
  useUnsaved(form.formState.isDirty)
  return (
    <EditorSheet
      title={
        kind === "connection" ? "Add broker connection" : "Register gateway"
      }
      description={
        kind === "connection"
          ? "Reserves a unique group on the managed broker."
          : "Uses the Edge Node identifier your gateway reports. Its credentials come from a CLI export afterwards."
      }
      dirty={form.formState.isDirty}
      busy={form.formState.isSubmitting}
      onClose={onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          try {
            if (kind === "connection")
              await api.createConnection(org, {
                name: values.name,
                group_id: values.identifier,
              })
            else
              await api.createGateway(org, {
                name: values.name,
                edge_node_id: values.identifier,
                connection_uuid: values.connection,
              })
            form.reset(values)
            await onSaved()
          } catch (reason) {
            setError(reason)
          }
        })}
      >
        <div className="flex-1 overflow-auto p-6">
          <FieldGroup>
            <TextField label="Name" required {...form.register("name")} />
            {kind === "gateway" && (
              <Choice
                label="Connection"
                value={form.watch("connection")}
                onChange={(v) =>
                  form.setValue("connection", v, { shouldDirty: true })
                }
                options={[
                  { value: "", label: "Select connection" },
                  ...connections,
                ]}
              />
            )}
            <TextField
              label={
                kind === "connection"
                  ? "Group identifier"
                  : "Edge Node identifier"
              }
              required
              {...form.register("identifier")}
              help="Use letters, numbers, dots, colons, underscores, or dashes."
            />
            <RequestError error={error} />
          </FieldGroup>
        </div>
        <SaveBar
          dirty={form.formState.isDirty}
          busy={form.formState.isSubmitting}
          onCancel={onClose}
          label={
            kind === "connection" ? "Create connection" : "Register gateway"
          }
        />
      </form>
    </EditorSheet>
  )
}
