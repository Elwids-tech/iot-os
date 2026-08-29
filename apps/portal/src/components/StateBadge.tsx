import type { DefinitionState, DeviceLifecycleState } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"

export function StateBadge({ state }: { state: DefinitionState | DeviceLifecycleState }) {
  const variant = state === "archived" || state === "retired" ? "outline" : "secondary"

  return <Badge variant={variant}>{state}</Badge>
}
