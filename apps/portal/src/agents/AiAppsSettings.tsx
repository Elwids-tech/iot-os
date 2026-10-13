import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BotIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { SwitchField } from "@iot-os/ui/components/form-fields"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@iot-os/ui/components/input-group"
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { useAdministration } from "../members/shared"
import { connectSteps } from "./model"

/** Connected AI apps: the organization's switch, how to connect an agent, and connections. */
export function AiAppsSettings() {
  const { org } = useAdministration()
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ["agent-access", org], queryFn: () => api.agentAccess(org) })
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setAgentAccess(org, enabled),
    onSuccess: (data) => {
      client.setQueryData(["agent-access", org], data)
      void client.invalidateQueries({ queryKey: ["session"] })
      toast.success(data.enabled ? "AI agents can now connect to this organization" : "AI agent access is off for this organization")
    },
  })
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
              onCheckedChange={(enabled) => toggle.mutate(enabled)}
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
          <PanelDescription>Agents you connected to this organization. Disconnecting stops them at their next request.</PanelDescription>
        </PanelHeader>
        <PanelContent>
          <EmptyState inset icon={<BotIcon />} title="No connected apps yet" description="Connect an agent with the address above." />
        </PanelContent>
      </Panel>
      {data?.can_manage && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Connections to this organization</PanelTitle>
            <PanelDescription>Every member's connected agents, with what they did.</PanelDescription>
          </PanelHeader>
          <PanelContent>
            <EmptyState inset icon={<BotIcon />} title="No connected apps yet" />
          </PanelContent>
        </Panel>
      )}
    </div>
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
