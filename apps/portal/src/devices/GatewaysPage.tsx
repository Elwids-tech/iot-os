import { Link, useSearchParams } from "react-router-dom"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import type {
  Device,
  Gateway,
  SparkplugConnection,
} from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { EllipsisIcon, PlusIcon, XIcon } from "lucide-react"
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
import {
  Age,
  devicePath,
  DevicePages,
  DeviceStatus,
  DeviceEmpty,
  discoveryPath,
  metricCount,
  Section,
  useDeviceOrganization,
} from "./shared"

export function GatewaysPage() {
  const { org, capabilities } = useDeviceOrganization()
  const [params, setParams] = useSearchParams()
  const selectedUuid = params.get("gateway") ?? ""
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
  const sources = useQuery({
    queryKey: ["discovery-directory", org, "gateway", selectedUuid],
    queryFn: () =>
      api.discoveryPage(org, { gateway_uuid: selectedUuid, per_page: 100 }),
    enabled: Boolean(selectedUuid),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  })
  const selected =
    gateways.data?.data.find((g) => g.uuid === selectedUuid) ??
    devices.data
      ?.map((d) => d.candidate?.gateway)
      .find((g) => g?.uuid === selectedUuid) ??
    sources.data?.data[0]?.gateway
  const [editor, setEditor] = useState<"connection" | "gateway" | null>(null),
    [error, setError] = useState<unknown>(null),
    [provision, setProvision] = useState<
      | { kind: "gateway"; item: Gateway }
      | { kind: "connection"; item: SparkplugConnection }
      | null
    >(null),
    [credentials, setCredentials] = useState<Gateway | null>(null)
  const ready = connections.data?.data.some((c) => c.status === "ready")
  function select(uuid: string) {
    const next = new URLSearchParams(params)
    if (uuid) next.set("gateway", uuid)
    else next.delete("gateway")
    setParams(next, { replace: true })
  }
  return (
    <>
      <PageHeader
        title="Gateways"
        actions={
          capabilities.connections && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditor("connection")}>
                Add connection
              </Button>
              <Button size="sm" onClick={() => setEditor("gateway")} disabled={!ready}>
                <PlusIcon data-icon="inline-start" />
                Register gateway
              </Button>
            </>
          )
        }
      >
        <Input
          aria-label="Find a gateway"
          placeholder="Find a gateway"
          className="h-8 w-full sm:w-64"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        {gateways.data && (
          <span className="ml-auto text-sm text-muted-foreground" role="status">
            {gateways.data.meta.total === 1
              ? "1 gateway"
              : `${gateways.data.meta.total} gateways`}
          </span>
        )}
      </PageHeader>
      <div className="grid items-start gap-8 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-6">
        <div className="flex min-w-0 flex-col gap-8">
          <RequestError error={error ?? gateways.error ?? connections.error} />
          {capabilities.connections && connections.data && !ready && (
            <p className="text-sm text-muted-foreground">
              Register gateway needs a broker connection that is ready.
            </p>
          )}
          <Section title="Gateways">
            {gateways.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : gateways.data?.data.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gateway</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Presence</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                    <TableHead className="text-right">Last seen</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gateways.data.data.map((g) => (
                    <TableRow
                      key={g.uuid}
                      data-state={g.uuid === selectedUuid ? "selected" : undefined}
                    >
                      <TableCell>
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          to={"?gateway=" + encodeURIComponent(g.uuid)}
                          aria-current={g.uuid === selectedUuid ? "true" : undefined}
                          replace
                        >
                          {g.name}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {g.edge_node_id}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                        {g.group_id}
                      </TableCell>
                      <TableCell>
                        <DeviceStatus value={g.presence} />
                      </TableCell>
                      <TableCell>
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          to={discoveryPath(org, g.uuid)}
                        >
                          {g.sources_count === 1 ? "1 source" : `${g.sources_count} sources`}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {devices.data ? (byGateway.get(g.uuid)?.length ?? 0) : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        <Age value={g.last_seen_at} />
                      </TableCell>
                      <TableCell className="text-right">
                        <GatewayMenu
                          gateway={g}
                          org={org}
                          canProvision={capabilities.connections}
                          onProvision={() => setProvision({ kind: "gateway", item: g })}
                          onCredentials={() => setCredentials(g)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : search ? (
              <DeviceEmpty title="No matching gateways" />
            ) : (
              <DeviceEmpty
                title="No gateways yet"
                description="Add a broker connection and register a gateway. Its credentials come from a CLI export on the server, never from this page."
              />
            )}
            <DevicePages
              meta={gateways.data?.meta}
              onPage={setPage}
              label="Gateways"
            />
          </Section>
          <Section title="Broker connections">
            {connections.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : connections.data?.data.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Connection</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.data.data.map((c) => (
                    <TableRow key={c.uuid}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                        {c.group_id}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <DeviceStatus value={c.status} />
                        {c.diagnostic && (
                          <p className="max-w-sm text-xs text-muted-foreground">
                            {c.diagnostic}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {capabilities.connections && c.status !== "ready" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProvision({ kind: "connection", item: c })}
                          >
                            {c.status === "failed" ? "Retry provisioning" : "Provision"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <DeviceEmpty
                title="No broker connections yet"
                description={
                  capabilities.connections
                    ? "Add a connection to reserve a group on the broker."
                    : undefined
                }
              />
            )}
            <DevicePages
              meta={connections.data?.meta}
              onPage={setConnectionPage}
              label="Connections"
            />
          </Section>
        </div>
        {selectedUuid && (
          <aside
            aria-label="Selected gateway"
            className="flex min-w-0 flex-col gap-6 max-xl:order-first max-xl:border-b max-xl:pb-6 xl:sticky xl:top-4 xl:border-l xl:pl-6"
          >
            {selected ? (
              <>
                <Section
                  title={selected.name}
                  actions={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Close gateway details"
                      onClick={() => select("")}
                    >
                      <XIcon />
                    </Button>
                  }
                >
                  <p className="mb-3 flex flex-wrap items-center gap-x-3 text-sm">
                    <DeviceStatus value={selected.presence} />
                    <span className="text-muted-foreground">
                      Last seen <Age value={selected.last_seen_at} never="never" />
                    </span>
                  </p>
                  <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Edge node id</dt>
                    <dd className="font-mono break-all">{selected.edge_node_id}</dd>
                    <dt className="text-muted-foreground">Connection</dt>
                    <dd>
                      {connections.data?.data.find((c) => c.uuid === selected.connection_uuid)
                        ?.name ?? "Not on this page"}
                    </dd>
                    <dt className="text-muted-foreground">Group</dt>
                    <dd className="font-mono break-all">{selected.group_id}</dd>
                  </dl>
                  {capabilities.connections && (
                    <Button
                      className="mt-3"
                      variant="outline"
                      size="sm"
                      onClick={() => setProvision({ kind: "gateway", item: selected })}
                    >
                      Apply gateway access
                    </Button>
                  )}
                </Section>
                <Section
                  title="Devices"
                  meta={devices.data ? (byGateway.get(selected.uuid)?.length ?? 0) : undefined}
                >
                  {byGateway.get(selected.uuid)?.length ? (
                    <ul className="flex flex-col gap-2 text-sm">
                      {byGateway.get(selected.uuid)!.map((d) => (
                        <li key={d.uuid} className="flex justify-between gap-3">
                          <Link
                            className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
                            to={devicePath(org, d.uuid)}
                          >
                            {d.name}
                          </Link>
                          <DeviceStatus value={d.lifecycle} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No devices use this gateway</p>
                  )}
                </Section>
                <Section
                  title="Sources"
                  actions={
                    <Button asChild variant="link" size="sm" className="h-auto p-0">
                      <Link to={discoveryPath(org, selected.uuid)}>Open in discovery</Link>
                    </Button>
                  }
                >
                  {sources.data?.data.length ? (
                    <ul className="flex flex-col gap-2 text-sm">
                      {sources.data.data.map((c) => (
                        <li key={c.uuid} className="flex flex-wrap justify-between gap-x-3">
                          <span className="min-w-0 truncate font-mono">
                            {c.source_device_id || "Gateway measurements"}
                          </span>
                          <span className="flex gap-2 text-muted-foreground">
                            <DeviceStatus value={c.status} />· {metricCount(c.metrics.length)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {sources.isPending ? "Loading sources" : "No sources announced yet"}
                    </p>
                  )}
                </Section>
                <Section title="Credentials">
                  <p className="text-sm text-muted-foreground">
                    Exported on the server with the CLI, never shown here.
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => setCredentials(selected)}
                  >
                    Get credentials
                  </Button>
                </Section>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {gateways.isPending || devices.isPending || sources.isPending
                  ? "Loading gateway"
                  : "This gateway is not on the current page."}
              </p>
            )}
          </aside>
        )}
      </div>
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
      <Dialog open={Boolean(credentials)} onOpenChange={(open) => !open && setCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Get gateway credentials</DialogTitle>
            <DialogDescription>
              The portal never shows credentials. An operator with server access
              exports them to a new file from the API container:
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
            php artisan devices:export-gateway {credentials?.uuid} --output=/tmp/gateway.json
            --broker=ssl://BROKER_HOST:8883 --ca=/path/on/gateway/ca.crt
          </pre>
          <p className="text-sm text-muted-foreground">
            Use the broker address and CA path the gateway can reach, then install
            the file and the CA certificate on the gateway.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredentials(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function GatewayMenu({
  gateway,
  org,
  canProvision,
  onProvision,
  onCredentials,
}: {
  gateway: Gateway
  org: string
  canProvision: boolean
  onProvision: () => void
  onCredentials: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${gateway.name}`}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canProvision && (
          <DropdownMenuItem onSelect={onProvision}>Apply gateway access</DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to={discoveryPath(org, gateway.uuid)}>Open in discovery</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCredentials}>Get credentials</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GatewayEditor({
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
