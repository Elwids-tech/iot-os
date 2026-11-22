import { useQueryClient } from "@tanstack/react-query"
import { productName, type AuthenticatedUser } from "@iot-os/api-client"
import { api } from "./api"

/**
 * What the product is called for the organization in view (spec 036, FR-009): the name
 * its billing account gave it, else this address's brand, else the platform's name.
 */
export function useProductName(): string {
  const user = useQueryClient().getQueryData<AuthenticatedUser>(["session"])
  const selected = api.getSelectedOrganizationUuid()
  return user?.organizations.find((organization) => organization.uuid === selected)?.brand?.product_name ?? productName()
}
