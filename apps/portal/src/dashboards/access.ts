import { useQuery } from "@tanstack/react-query"
import type { Dashboard, DashboardAbilities, DashboardCapabilities } from "@iot-os/api-client"
import { api } from "../lib/api"

/**
 * The signed-in person's dashboard permissions in an organization. APIs from
 * before dashboard permissions fall back to the device ones they replaced.
 */
export function useDashboardCapabilities(org: string): DashboardCapabilities {
  const session = useQuery({ queryKey: ["session"], queryFn: () => api.me(), staleTime: 60000 })
  const capabilities = session.data?.organizations.find((o) => o.uuid === org)?.capabilities
  return (
    capabilities?.dashboards ?? {
      view: capabilities?.devices?.view ?? true,
      create: capabilities?.devices?.manage ?? false,
      manage: capabilities?.devices?.manage ?? false,
    }
  )
}

/** What the person may do with one dashboard; older APIs send no abilities. */
export function dashboardAbilities(dashboard: Pick<Dashboard, "abilities">, capabilities: DashboardCapabilities): DashboardAbilities {
  return dashboard.abilities ?? { edit: capabilities.manage, share: false, delete: capabilities.manage }
}
