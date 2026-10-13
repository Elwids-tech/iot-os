import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { BotIcon, CornerDownLeftIcon, ShieldAlertIcon } from "lucide-react"
import { ApiError, type AgentAccessLevel, type AgentAuthorization } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import { FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { RadioGroup } from "@iot-os/ui/components/radio-group"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { RequestError } from "../components/forms"
import { api, apiBaseUrl } from "../lib/api"
import { isAgentAuthorizeUrl } from "./model"

/**
 * /connect: an AI agent asked to act for the signed-in person. Signed-out people see
 * the portal's sign-in first (Session) and come back here.
 */
export default function ConnectPage() {
  const [params] = useSearchParams()
  const returnTo = params.get("return")
  return (
    <main className="flex min-h-svh items-center justify-center p-5">
      <Card className="w-full max-w-lg">{returnTo === null ? <Consent /> : <ReturnToAgent url={returnTo} />}</Card>
    </main>
  )
}

/** After sign-in, resume the agent's authorize request on the API. */
function ReturnToAgent({ url }: { url: string }) {
  const allowed = isAgentAuthorizeUrl(url, apiBaseUrl)
  useEffect(() => {
    if (allowed) window.location.assign(url)
  }, [allowed, url])
  return (
    <CardHeader>
      <CardTitle>
        <h1>Connect an AI agent</h1>
      </CardTitle>
      <CardDescription>
        {allowed ? "Continuing your agent's connection request…" : "This link does not lead to an agent connection request. Start again from your agent."}
      </CardDescription>
    </CardHeader>
  )
}

function Consent() {
  const pending = useQuery({
    queryKey: ["agent-authorization"],
    queryFn: () => api.currentAgentAuthorization(),
    retry: false,
    refetchOnWindowFocus: false,
  })
  if (pending.isPending)
    return (
      <CardContent className="flex flex-col gap-3 py-6" aria-label="Loading the connection request">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full" />
      </CardContent>
    )
  if (pending.error instanceof ApiError && [404, 409].includes(pending.error.status)) return <NothingPending />
  if (pending.error)
    return (
      <CardContent className="py-6">
        <RequestError error={pending.error} />
      </CardContent>
    )
  return <Decision request={pending.data} />
}

function NothingPending() {
  return (
    <CardHeader>
      <CardTitle>
        <h1>No connection is waiting</h1>
      </CardTitle>
      <CardDescription>
        This connection request has expired, was answered, or was replaced by a newer one. Start again from your agent.
      </CardDescription>
    </CardHeader>
  )
}

const levels: Record<AgentAccessLevel, { title: string; description: string }> = {
  read: { title: "Read", description: "Investigate devices, readings, alerts and dashboards." },
  draft: { title: "Read and drafts", description: "Also prepare changes that you review and apply here." },
}

function Decision({ request }: { request: AgentAuthorization }) {
  const available = request.organizations.filter((organization) => organization.available)
  const unavailable = request.organizations.filter((organization) => !organization.available)
  const [organization, setOrganization] = useState(available.length === 1 ? available[0].uuid : "")
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState<AgentAccessLevel>("read")
  const [done, setDone] = useState<"approved" | "denied" | null>(null)
  const options = useMemo(
    () =>
      available
        .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
        .map((item) => ({ value: item.uuid, label: item.name })),
    [available, search],
  )
  const leave = (redirect: string, outcome: "approved" | "denied") => {
    setDone(outcome)
    window.location.assign(redirect)
  }
  const approve = useMutation({
    mutationFn: () => api.approveAgentAuthorization({ auth_token: request.auth_token, organization_uuid: organization, access_level: level }),
    onSuccess: (data) => leave(data.redirect_to, "approved"),
  })
  const deny = useMutation({
    mutationFn: () => api.denyAgentAuthorization(request.auth_token),
    onSuccess: (data) => leave(data.redirect_to, "denied"),
  })
  const error = approve.error ?? deny.error
  if (error instanceof ApiError && [404, 409].includes(error.status)) return <NothingPending />
  if (done)
    return (
      <CardHeader>
        <CardTitle>
          <h1>{done === "approved" ? "Connected" : "Connection refused"}</h1>
        </CardTitle>
        <CardDescription>Returning to your agent at {request.redirect_host}…</CardDescription>
      </CardHeader>
    )
  const busy = approve.isPending || deny.isPending
  return (
    <>
      <CardHeader>
        <BotIcon className="mb-2 text-primary" aria-hidden />
        <CardTitle>
          <h1>Connect an AI agent</h1>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <CornerDownLeftIcon className="size-4" aria-hidden />
          <span>
            Returns to <strong className="text-foreground">{request.redirect_host}</strong>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-heading">{request.client.name}</span>
          <Badge variant="secondary">Self-declared name</Badge>
        </div>
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>The agent acts with your permissions</AlertTitle>
          <AlertDescription>
            Approve only if you just started this from your agent. It can never publish, activate, deploy, send device
            commands or delete, and it never sees passwords or device credentials.
          </AlertDescription>
        </Alert>
        {available.length === 0 ? (
          <Alert variant="destructive">
            <AlertTitle>No organization allows agents yet</AlertTitle>
            <AlertDescription>An organization administrator switches agent access on under Settings → AI apps.</AlertDescription>
          </Alert>
        ) : (
          <SearchableSelect
            label="Organization"
            value={organization}
            selectedLabel={available.find((item) => item.uuid === organization)?.name}
            options={options}
            search={search}
            onSearchChange={setSearch}
            onChange={setOrganization}
            placeholder="Choose an organization"
            help="The agent works in this organization only."
          />
        )}
        {unavailable.length > 0 && (
          <div className="flex flex-col gap-1 text-meta text-muted-foreground">
            <span>Agent access is off in:</span>
            <ul className="flex flex-col gap-1">
              {unavailable.map((item) => (
                <li key={item.uuid}>
                  {item.name}
                  {item.can_manage && (
                    <>
                      {" · "}
                      <Link className="text-primary underline underline-offset-4" to={`/organizations/${item.uuid}/settings/ai-apps`}>
                        Switch it on
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <FieldSet>
          <FieldLegend variant="label">Access</FieldLegend>
          <RadioGroup value={level} onValueChange={(value) => setLevel(value as AgentAccessLevel)} className="gap-2">
            {request.access_levels.map((value) => (
              <ChoiceCard key={value} value={value} title={levels[value].title} description={levels[value].description} />
            ))}
          </RadioGroup>
        </FieldSet>
        <RequestError error={error} />
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => deny.mutate()}>
          Deny
        </Button>
        <Button disabled={busy || organization === ""} onClick={() => approve.mutate()}>
          {approve.isPending ? "Connecting…" : "Approve"}
        </Button>
      </CardFooter>
    </>
  )
}
