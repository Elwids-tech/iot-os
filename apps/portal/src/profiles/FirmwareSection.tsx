import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { FirmwareRole, FirmwareTarget, StarterManifest } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import { Field, FieldDescription, FieldLabel } from "@iot-os/ui/components/field"
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { RadioGroup } from "@iot-os/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { DownloadIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { saveArchive } from "../lib/download"
import { RequestError } from "../components/forms"
import { useStudio } from "./use-studio"

/** The organization's health profile for gateways (spec 026), when one is published. */
const GATEWAY_HEALTH = "gateway-health"

/**
 * Firmware starters for this profile (spec 027 US1): a target, a role, and a credential-free
 * project with the SDK, the metric tables and instructions for AI coding agents.
 */
export function FirmwareSection() {
  const { org, profile } = useStudio()
  const [target, setTarget] = useState("")
  const [role, setRole] = useState<FirmwareRole>("direct")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [manifest, setManifest] = useState<StarterManifest | null>(null)
  const targets = useQuery({
    queryKey: ["firmware-targets", org],
    queryFn: ({ signal }) => api.firmwareTargets(org, signal),
    enabled: profile.revision > 0,
    staleTime: 5 * 60_000,
  })

  if (profile.revision === 0)
    return (
      <Panel aria-labelledby="firmware-title">
        <PanelHeader>
          <PanelTitle id="firmware-title">Firmware</PanelTitle>
        </PanelHeader>
        <PanelContent>
          <p className="text-muted-foreground">Publish to download firmware. Starters are built from a published version.</p>
        </PanelContent>
      </Panel>
    )

  const options = targets.data ?? []
  const chosen = options.find((item) => item.id === target)
  const groups: [string, FirmwareTarget[]][] = [
    ["Built", options.filter((item) => item.kind === "built")],
    ["AI-assisted", options.filter((item) => item.kind === "ai_assisted")],
  ]

  async function download() {
    if (!chosen || busy) return
    setBusy(true)
    setError(null)
    try {
      const artifact = await publishedArtifact(org, profile.uuid)
      const starter =
        role === "direct"
          ? await api.createFirmwareStarter(org, { target: chosen.id, role, node_artifact_uuid: artifact })
          : await api.createFirmwareStarter(org, {
              target: chosen.id,
              role,
              node_artifact_uuid: await gatewayHealthArtifact(org),
              device_type_artifact_uuids: [artifact],
            })
      saveArchive(starter)
      setManifest(starter.manifest)
      toast.success("Starter downloaded")
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-w-0 items-start gap-(--panel-gap) xl:grid-cols-[minmax(0,48rem)_var(--rail-width)]">
      <Panel aria-labelledby="firmware-title">
        <PanelHeader>
          <PanelTitle id="firmware-title">Firmware</PanelTitle>
          <PanelDescription>
            A starter project for version {profile.revision}: the IoT OS SDK, this profile's metrics, and
            instructions that let an AI coding agent ask about your hardware and write the code that reads it.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-6">
          <Field>
            <FieldLabel htmlFor="firmware-target">Microcontroller or platform</FieldLabel>
            <Select value={target} onValueChange={setTarget} disabled={targets.isPending}>
              <SelectTrigger id="firmware-target" className="w-full max-w-sm">
                <SelectValue placeholder={targets.isPending ? "Loading targets…" : "Choose a target"} />
              </SelectTrigger>
              <SelectContent>
                {groups
                  .filter(([, items]) => items.length > 0)
                  .map(([label, items]) => (
                    <SelectGroup key={label}>
                      <SelectLabel>{label}</SelectLabel>
                      {items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                          {item.kind === "ai_assisted" && (
                            <span className="text-meta text-muted-foreground"> · no tested example</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {chosen?.kind === "built"
                ? `Builds as downloaded with ${chosen.toolchain}.`
                : chosen
                  ? "Comes with port templates and notes. Your coding agent writes the port before the field code."
                  : "Built targets have a tested project. AI-assisted ones have templates for a coding agent to fill."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel id="firmware-role">How the device connects</FieldLabel>
            <RadioGroup
              aria-labelledby="firmware-role"
              value={role}
              onValueChange={(value) => setRole(value as FirmwareRole)}
              className="grid gap-3 sm:grid-cols-2"
            >
              <ChoiceCard value="direct" title="Connects directly" description="The device has its own network connection and publishes this profile's metrics." />
              <ChoiceCard
                value="gateway"
                title="Behind a gateway"
                description="A gateway reads devices of this profile, for example over Modbus, and publishes them with its own health."
              />
            </RadioGroup>
          </Field>
          <RequestError error={error} />
          {manifest && manifest.warnings.length > 0 && (
            <Alert>
              <AlertTitle>Check before building</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {manifest.warnings.map((warning) => (
                    <li key={warning.code + warning.subject}>{warning.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div>
            <Button onClick={() => void download()} disabled={!chosen || busy}>
              <DownloadIcon />
              {busy ? "Preparing…" : "Download starter"}
            </Button>
          </div>
        </PanelContent>
        <PanelFooter>
          The starter holds no credentials. Connection settings come from the device's page, or the gateway's.
        </PanelFooter>
      </Panel>
    </div>
  )
}

/** The profile's newest published artifact. */
async function publishedArtifact(org: string, profile: string): Promise<string> {
  const artifacts = (await api.profileArtifacts(org, profile)).data
  const active = artifacts.find((item) => item.status === "active") ?? [...artifacts].sort((a, b) => b.revision - a.revision)[0]
  if (!active) throw new Error("This profile has no published version.")
  return active.uuid
}

/** The organization's published gateway health profile, or null for the SDK's default health table. */
async function gatewayHealthArtifact(org: string): Promise<string | null> {
  const page = await api.deviceProfiles(org, { search: GATEWAY_HEALTH, perPage: 25 })
  const health = page.data.find((item) => item.code === GATEWAY_HEALTH && item.revision > 0)
  return health ? publishedArtifact(org, health.uuid) : null
}
