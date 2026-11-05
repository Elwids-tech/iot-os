import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { FirmwareOffer } from "@iot-os/api-client"
import { ActionCard } from "@iot-os/ui/components/action-card"
import { Button } from "@iot-os/ui/components/button"
import { CpuIcon, DownloadIcon } from "lucide-react"
import { api } from "../lib/api"
import { saveArchive } from "../lib/download"
import { profileStarter, useFirmwareTargets } from "../lib/firmware"
import { RequestError } from "../components/forms"

/**
 * A firmware starter the assistant offered (spec 027 US5). Pressing it downloads the starter
 * with the person's own session; the assistant never sees the archive or any settings.
 */
export function FirmwareOfferCard({ org, offer, disabled }: { org: string; offer: FirmwareOffer; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)
  const targets = useFirmwareTargets(org)
  const profile = useQuery({
    queryKey: ["profile", org, offer.profile_uuid],
    queryFn: () => api.deviceProfile(org, offer.profile_uuid),
  })
  const target = targets.data?.find((item) => item.id === offer.target)?.name ?? offer.target
  const name = profile.data?.name ?? "this profile"

  async function download() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      saveArchive(await profileStarter(org, offer.profile_uuid, offer.target, offer.role))
      setDone(true)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ActionCard
      icon={CpuIcon}
      label="Firmware"
      title={`${target} starter for ${name}`}
      description={
        offer.role === "direct"
          ? "For a device that connects directly: the SDK, the profile's metrics and instructions for an AI coding agent. No credentials."
          : "For a gateway that reads devices of this profile: the SDK, the metrics and instructions for an AI coding agent. No credentials."
      }
    >
      <Button size="sm" disabled={disabled || busy} onClick={() => void download()}>
        <DownloadIcon data-icon="inline-start" />
        {busy ? "Preparing…" : "Download starter"}
      </Button>
      <span role="status" className="text-meta text-muted-foreground">
        {done && "Downloaded. Connection settings come from the device's or gateway's page."}
      </span>
      <RequestError error={error} />
    </ActionCard>
  )
}
