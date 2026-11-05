import { useQuery } from "@tanstack/react-query"
import type { DeviceProfile, FirmwareArchive, FirmwareRole, FirmwareTarget } from "@iot-os/api-client"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { api } from "./api"

/** The organization's health profile for gateways (spec 026), when one is published. */
export const GATEWAY_HEALTH = "gateway-health"

/** The firmware targets this organization can download, optionally only those that support a role. */
export function useFirmwareTargets(org: string, role?: FirmwareRole, enabled = true) {
  const targets = useQuery({
    queryKey: ["firmware-targets", org],
    queryFn: ({ signal }) => api.firmwareTargets(org, signal),
    enabled,
    staleTime: 5 * 60_000,
  })
  return { ...targets, options: (targets.data ?? []).filter((item) => !role || item.roles.includes(role)) }
}

/** The target picker every firmware download shares: built targets first, AI-assisted ones marked. */
export function FirmwareTargetSelect({
  id,
  targets,
  value,
  onChange,
  loading,
  className = "w-full",
}: {
  id: string
  targets: FirmwareTarget[]
  value: string
  onChange: (target: string) => void
  loading: boolean
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={loading}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={loading ? "Loading targets…" : "Choose a target"} />
      </SelectTrigger>
      <SelectContent>
        {(["built", "ai_assisted"] as const).map((kind) => {
          const items = targets.filter((item) => item.kind === kind)
          return items.length ? (
            <SelectGroup key={kind}>
              <SelectLabel>{kind === "built" ? "Built" : "AI-assisted"}</SelectLabel>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                  {kind === "ai_assisted" && <span className="text-meta text-muted-foreground"> · no tested example</span>}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null
        })}
      </SelectContent>
    </Select>
  )
}

/** The profile's newest published artifact. */
export async function publishedArtifact(org: string, profile: string): Promise<string> {
  const artifacts = (await api.profileArtifacts(org, profile)).data
  const active = artifacts.find((item) => item.status === "active") ?? [...artifacts].sort((a, b) => b.revision - a.revision)[0]
  if (!active) throw new Error("This profile has no published version.")
  return active.uuid
}

/** The organization's published gateway health profile, or null when there is none. */
export async function gatewayHealthProfile(org: string): Promise<DeviceProfile | null> {
  const page = await api.deviceProfiles(org, { search: GATEWAY_HEALTH, perPage: 25 })
  return page.data.find((item) => item.code === GATEWAY_HEALTH && item.revision > 0) ?? null
}

/** The published gateway health artifact, or null for the SDK's default health table. */
export async function gatewayHealthArtifact(org: string): Promise<string | null> {
  const health = await gatewayHealthProfile(org)
  return health ? publishedArtifact(org, health.uuid) : null
}

/**
 * A credential-free starter for one profile: the node for a direct device, or a device type
 * behind the gateway health node. The profile page and the assistant's card build the same request.
 */
export async function profileStarter(org: string, profile: string, target: string, role: FirmwareRole): Promise<FirmwareArchive> {
  const artifact = await publishedArtifact(org, profile)
  return role === "direct"
    ? api.createFirmwareStarter(org, { target, role, node_artifact_uuid: artifact })
    : api.createFirmwareStarter(org, {
        target,
        role,
        node_artifact_uuid: await gatewayHealthArtifact(org),
        device_type_artifact_uuids: [artifact],
      })
}
