import { Link } from "react-router-dom"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card"
import { FieldGroup } from "@iot-os/ui/components/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { PlusIcon } from "lucide-react"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import {
  Choice,
  TextField,
  RequestError,
  EditorSheet,
  SaveBar,
} from "../components/forms"
import {
  DevicePages,
  DeviceStatus,
  DeviceEmpty,
  formatTime,
  useDeviceOrganization,
} from "./shared"

export function GatewaysPage() {
  const { org, capabilities } = useDeviceOrganization()
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
  const [editor, setEditor] = useState<"connection" | "gateway" | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Gateways</h1>
          <p className="text-muted-foreground">
            Sparkplug Edge Nodes connect equipment to this workspace.
          </p>
        </div>
        {capabilities.connections && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditor("connection")}>
              Add connection
            </Button>
            <Button
              onClick={() => setEditor("gateway")}
              disabled={
                !connections.data?.data.some((c) => c.status === "ready")
              }
            >
              <PlusIcon data-icon="inline-start" />
              Register gateway
            </Button>
          </div>
        )}
      </div>
      <RequestError error={error ?? gateways.error ?? connections.error} />
      <TextField
        label="Find a gateway"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(1)
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>Gateway sources</CardTitle>
          <CardDescription>
            Each Edge Node can report its own measurements and serve downstream
            devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {gateways.data?.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Sources</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Provisioning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gateways.data.data.map((g) => (
                  <TableRow key={g.uuid}>
                    <TableCell>
                      {g.name}
                      <p className="text-xs text-muted-foreground">
                        {g.edge_node_id}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      {g.group_id}
                    </TableCell>
                    <TableCell>
                      <DeviceStatus value={g.presence} />
                    </TableCell>
                    <TableCell>
                      <Link
                        className="underline"
                        to={`/organizations/${org}/discovery?gateway=${g.uuid}`}
                      >
                        {g.sources_count} sources
                      </Link>
                    </TableCell>
                    <TableCell>{formatTime(g.last_seen_at)}</TableCell>
                    <TableCell>
                      {capabilities.connections && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true)
                            setError(null)
                            try {
                              await api.provisionGateway(org, g.uuid)
                              await gateways.refetch()
                            } catch (reason) {
                              setError(reason)
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          Apply gateway access
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <DeviceEmpty
              title="No gateways yet"
              description="Add a connection, register an Edge Node, then configure its credentials on the gateway."
            />
          )}
          <DevicePages
            meta={gateways.data?.meta}
            onPage={setPage}
            label="Gateways"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Broker connections</CardTitle>
          <CardDescription>
            Connections reserve an organization namespace on the managed broker.
            Credentials are provisioned separately and are never displayed in
            this list.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Group identifier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.data?.data.map((c) => (
                <TableRow key={c.uuid}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="max-w-64 truncate">
                    {c.group_id}
                  </TableCell>
                  <TableCell>
                    <DeviceStatus value={c.status} />
                    {c.diagnostic && (
                      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                        {c.diagnostic}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {capabilities.connections && c.status !== "ready" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true)
                          setError(null)
                          try {
                            await api.provisionConnection(org, c.uuid)
                            await connections.refetch()
                          } catch (reason) {
                            setError(reason)
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        Retry provisioning
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DevicePages
            meta={connections.data?.meta}
            onPage={setConnectionPage}
            label="Connections"
          />
        </CardContent>
      </Card>
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
    </div>
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
          ? "Reserve a unique group on the managed EMQX broker."
          : "Register the Edge Node identifier used by your gateway. An administrator provisions its private connection configuration."
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
