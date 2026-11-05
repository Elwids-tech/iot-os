import { useState } from "react"
import type { FirmwareRole, StarterManifest } from "@iot-os/api-client"
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
import { DownloadIcon } from "lucide-react"
import { toast } from "sonner"
import { saveArchive } from "../lib/download"
import { FirmwareTargetSelect, profileStarter, useFirmwareTargets } from "../lib/firmware"
import { RequestError } from "../components/forms"
import { useStudio } from "./use-studio"

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
  const targets = useFirmwareTargets(org, undefined, profile.revision > 0)

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

  const chosen = targets.options.find((item) => item.id === target)

  async function download() {
    if (!chosen || busy) return
    setBusy(true)
    setError(null)
    try {
      const starter = await profileStarter(org, profile.uuid, chosen.id, role)
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
            <FirmwareTargetSelect
              id="firmware-target"
              targets={targets.options}
              value={target}
              onChange={setTarget}
              loading={targets.isPending}
              className="w-full max-w-sm"
            />
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
