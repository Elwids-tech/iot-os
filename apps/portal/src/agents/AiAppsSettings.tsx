import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BotIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"
import type { AgentConnection } from "@iot-os/api-client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { SwitchField } from "@iot-os/ui/components/form-fields"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@iot-os/ui/components/input-group"
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@iot-os/ui/components/sheet"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { useAdministration } from "../members/shared"
import { connectSteps, revocationLabel } from "./model"

/** Connected AI apps: the organization's switch, how to connect an agent, and connections. */
export function AiAppsSettings() {
  const { org } = useAdministration()
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ["agent-access", org], queryFn: () => api.agentAccess(org) })
  const manage = settings.data?.can_manage === true
  const mine = useQuery({ queryKey: ["agent-connections", "mine"], queryFn: () => api.myAgentConnections() })
  const all = useQuery({
    queryKey: ["agent-connections", org],
    queryFn: () => api.organizationAgentConnections(org),
    enabled: manage,
  })
  const [confirmOff, setConfirmOff] = useState(false)
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setAgentAccess(org, enabled),
    onSuccess: (data) => {
      client.setQueryData(["agent-access", org], data)
      void client.invalidateQueries({ queryKey: ["session"] })
      void client.invalidateQueries({ queryKey: ["agent-connections"] })
      toast.success(data.enabled ? "AI agents can now connect to this organization" : "AI agent access is off for this organization")
    },
  })
  const activeHere = (all.data ?? []).filter((connection) => connection.state === "active").length
  const data = settings.data
  return (
    <div className="flex max-w-form flex-col gap-(--panel-gap)">
      <h2 className="text-title">Connected AI apps</h2>
      <RequestError error={settings.error ?? toggle.error} />
      <Panel>
        <PanelHeader>
          <PanelTitle>Agent access</PanelTitle>
          <PanelDescription>
            Members can connect Claude and other MCP clients to investigate devices and prepare changes. Agents act with
            each member's own permissions. They never publish, activate, deploy, send device commands or delete, and
            prepared changes wait for a person to apply them here.
          </PanelDescription>
        </PanelHeader>
        <PanelContent>
          {!data ? (
            <Skeleton className="h-10 w-full" />
          ) : data.can_manage ? (
            <SwitchField
              align="end"
              label="Allow AI agents in this organization"
              description="Switching this off stops every connection at its next request."
              checked={data.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(enabled) => (!enabled && activeHere > 0 ? setConfirmOff(true) : toggle.mutate(enabled))}
            />
          ) : (
            <p className="text-body text-muted-foreground">
              {data.enabled
                ? "Agent access is on for this organization."
                : "Agent access is off for this organization. An organization administrator can switch it on."}
            </p>
          )}
        </PanelContent>
      </Panel>
      {data?.enabled && <ConnectPanel url={data.connector_url} />}
      <Panel>
        <PanelHeader>
          <PanelTitle>Your connections</PanelTitle>
          <PanelDescription>Agents you connected, in every organization. Disconnecting stops them at their next request.</PanelDescription>
        </PanelHeader>
        <PanelContent>
          <Connections id="agent-connections-mine" query={mine} personal />
        </PanelContent>
      </Panel>
      {manage && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Connections to this organization</PanelTitle>
            <PanelDescription>Every member's connected agents, with what they did.</PanelDescription>
          </PanelHeader>
          <PanelContent>
            <Connections id="agent-connections-organization" query={all} />
          </PanelContent>
        </Panel>
      )}
      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch off agent access?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeHere === 1 ? "1 connection stops" : `All ${activeHere} connections stop`} at their next request. They work
              again if you switch access back on, unless they were disconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOff(false)
                toggle.mutate(false)
              }}
            >
              Switch off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Connections({
  id,
  query,
  personal = false,
}: {
  id: string
  query: { data?: AgentConnection[]; error: unknown; refetch: () => unknown }
  personal?: boolean
}) {
  const { org } = useAdministration()
  const client = useQueryClient()
  const [disconnecting, setDisconnecting] = useState<AgentConnection | null>(null)
  const [activityOf, setActivityOf] = useState<AgentConnection | null>(null)
  const disconnect = useMutation({
    mutationFn: (connection: AgentConnection) =>
      personal ? api.disconnectMyAgent(connection.uuid) : api.disconnectAgent(org, connection.uuid),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["agent-connections"] })
      toast.success("Disconnected. The agent stops at its next request.")
    },
  })
  const columns = useMemo<DataColumn<AgentConnection>[]>(
    () => [
      {
        id: "agent",
        header: "Agent",
        mobile: "title",
        value: (connection) => connection.agent.name,
        cell: (connection) => (
          <span className="flex flex-col">
            <span className="font-medium">{connection.agent.name}</span>
            <span className="text-meta text-muted-foreground">Returns to {connection.agent.redirect_host || "unknown"}</span>
          </span>
        ),
      },
      ...(personal
        ? [
            {
              id: "organization",
              header: "Organization",
              value: (connection: AgentConnection) => connection.organization.name,
              cell: (connection: AgentConnection) => connection.organization.name,
            },
          ]
        : [
            {
              id: "member",
              header: "Member",
              value: (connection: AgentConnection) => connection.user?.name,
              cell: (connection: AgentConnection) => (
                <span className="flex flex-col">
                  <span>{connection.user?.name}</span>
                  <span className="text-meta text-muted-foreground">{connection.user?.email}</span>
                </span>
              ),
            },
          ]),
      {
        id: "access",
        header: "Access",
        value: (connection) => connection.access_level,
        cell: (connection) => (connection.access_level === "draft" ? "Read and drafts" : "Read"),
      },
      {
        id: "last-used",
        header: "Last used",
        value: (connection) => connection.last_used_at,
        cell: (connection) => <RelativeTime at={connection.last_used_at} never="Not yet" />,
      },
      {
        id: "created",
        header: "Connected",
        mobile: "hidden",
        value: (connection) => connection.created_at,
        cell: (connection) => <RelativeTime at={connection.created_at} />,
      },
      {
        id: "state",
        header: "State",
        mobile: "badge",
        value: (connection) => connection.state,
        cell: (connection) => (
          <span className="flex flex-col">
            <Status value={connection.state} />
            {connection.revoked_reason && (
              <span className="text-meta text-muted-foreground">{revocationLabel(connection.revoked_reason)}</span>
            )}
          </span>
        ),
      },
    ],
    [personal],
  )
  return (
    <>
      <RequestError error={disconnect.error} />
      <DataTable
        id={id}
        label={personal ? "Your connected AI apps" : "Connected AI apps in this organization"}
        noun={["connection", "connections"]}
        rows={query.data}
        rowKey={(connection) => connection.uuid}
        rowLabel={(connection) => `${connection.agent.name} in ${connection.organization.name}`}
        columns={columns}
        error={query.error ? <RequestError error={query.error} /> : undefined}
        empty={<EmptyState inset icon={<BotIcon />} title="No connected apps yet" description={personal ? "Connect an agent with the address above." : undefined} />}
        rowActions={(connection) => (
          <>
            <DropdownMenuItem onSelect={() => setActivityOf(connection)}>Activity</DropdownMenuItem>
            {connection.state !== "revoked" && (
              <DropdownMenuItem variant="destructive" onSelect={() => setDisconnecting(connection)}>
                Disconnect
              </DropdownMenuItem>
            )}
          </>
        )}
      />
      <AlertDialog open={disconnecting !== null} onOpenChange={(open) => !open && setDisconnecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnecting?.agent.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops at its next request. To use it again, connect it again from the agent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (disconnecting) disconnect.mutate(disconnecting)
                setDisconnecting(null)
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActivitySheet connection={activityOf} onClose={() => setActivityOf(null)} />
    </>
  )
}

function ActivitySheet({ connection, onClose }: { connection: AgentConnection | null; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const activity = useQuery({
    queryKey: ["agent-activity", connection?.uuid, page],
    queryFn: () => api.agentActivity(connection!.organization.uuid, connection!.uuid, page),
    enabled: connection !== null,
  })
  const meta = activity.data?.meta
  return (
    <Sheet
      open={connection !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPage(1)
          onClose()
        }
      }}
    >
      <SheetContent className="flex flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{connection?.agent.name} activity</SheetTitle>
          <SheetDescription>Every tool call in {connection?.organization.name}, newest first. Arguments and results are not stored.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <RequestError error={activity.error} />
          {activity.isPending && <Skeleton className="h-24 w-full" />}
          {activity.data?.data.length === 0 && <EmptyState inset icon={<BotIcon />} title="No calls yet" />}
          <ul className="flex flex-col divide-y">
            {activity.data?.data.map((entry, index) => (
              <li key={`${entry.created_at}-${index}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex flex-col">
                  <span className="font-mono text-code">{entry.tool}</span>
                  <span className="text-meta text-muted-foreground">
                    <RelativeTime at={entry.created_at} /> · {entry.duration_ms} ms
                    {entry.reason ? ` · ${entry.reason.replaceAll("_", " ")}` : ""}
                  </span>
                </span>
                <Status value={entry.outcome} />
              </li>
            ))}
          </ul>
          {meta && meta.last_page > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Newer
              </Button>
              <span className="text-meta text-muted-foreground">
                Page {meta.current_page} of {meta.last_page}
              </span>
              <Button variant="outline" size="sm" disabled={page >= meta.last_page} onClick={() => setPage(page + 1)}>
                Older
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ConnectPanel({ url }: { url: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Connector address copied")
    } catch {
      toast.error("Copy unavailable. Select the address and copy it manually.")
    }
  }
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Connect an agent</PanelTitle>
        <PanelDescription>Give your agent this address. It opens this portal so you can choose an organization and approve.</PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <InputGroup>
          <InputGroupInput aria-label="Connector address" value={url} readOnly className="font-mono" onFocus={(event) => event.currentTarget.select()} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton aria-label="Copy connector address" onClick={() => void copy()}>
              <CopyIcon />
              Copy
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          {connectSteps(url).map((item) => (
            <section key={item.client} className="flex flex-col gap-1">
              <h3 className="text-heading">{item.client}</h3>
              <ol className="list-decimal pl-4 text-meta text-muted-foreground">
                {item.steps.map((step) => (
                  <li key={step} className="break-words">
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </PanelContent>
    </Panel>
  )
}
