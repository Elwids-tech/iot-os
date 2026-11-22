import { useQuery } from "@tanstack/react-query"
import { api } from "./api"

/**
 * The origin a link a person copies should carry (spec 036, FR-033): the main address
 * of the organization's billing account, so a link copied on the platform's address
 * opens under the account's brand. The address the page is on when the account has
 * none, and until the organization's context has loaded.
 */
export function usePortalOrigin(organizationUuid: string): string {
  // The key the device pages use, so the context is fetched once.
  const context = useQuery({
    queryKey: ["device-organization", organizationUuid],
    queryFn: () => api.organizationContext(organizationUuid),
    enabled: organizationUuid !== "",
    staleTime: 60_000,
  })
  return context.data?.portal_url ?? globalThis.location.origin
}
