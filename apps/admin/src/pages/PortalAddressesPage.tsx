import { useCallback, useMemo } from "react"
import type { DirectoryQuery, PlatformPortalAddress } from "@iot-os/api-client"
import { DataTable, RefLink, type DataColumn, type DataFilter } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { statusOf } from "@iot-os/ui/lib/status"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { GlobeIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { AddressLink, AddressState, addressKind, canSuspend, usePortalAddressSuspension } from "../components/PortalAddressSuspension"
import { useDirectoryTable } from "../components/ResourceDirectory"
import { apiClient } from "../lib/api-client"
import { billingAccountPath } from "./BillingAccountsPage"

const states: PlatformPortalAddress["state"][] = ["active", "waiting_dns", "unreachable", "suspended", "lapsed"]

/**
 * Every billing account's portal addresses (spec 036 US6, FR-036): which are active,
 * waiting or not reachable, and the place to suspend or restore one.
 */
export function PortalAddressesPage() {
  const navigate = useNavigate()
  const url = useUrlState()
  const state = states.find((value) => value === url.get("state")) ?? null
  const load = useCallback((query: DirectoryQuery) => apiClient.adminPortalAddresses({ ...query, state: state ?? undefined }), [state])
  const { reload, table } = useDirectoryTable(load, { searchPlaceholder: "Address or billing account" })
  const suspension = usePortalAddressSuspension(reload)

  const columns = useMemo<DataColumn<PlatformPortalAddress>[]>(
    () => [
      {
        id: "address",
        header: "Address",
        mobile: "title",
        value: (address) => address.host,
        cell: (address) => <AddressLink address={address} />,
      },
      {
        id: "kind",
        header: "Kind",
        value: (address) => addressKind(address),
        cell: (address) => addressKind(address),
      },
      {
        id: "account",
        header: "Billing account",
        value: (address) => address.billing_account?.name ?? "",
        cell: (address) =>
          address.billing_account ? (
            <RefLink to={billingAccountPath(address.billing_account.uuid)}>{address.billing_account.name}</RefLink>
          ) : (
            <span className="text-muted-foreground">Deleted</span>
          ),
      },
      {
        id: "state",
        header: "State",
        mobile: "badge",
        hideable: false,
        value: (address) => address.state,
        cell: (address) => <AddressState address={address} serving={address.serving} />,
      },
      {
        id: "checked",
        header: "Last checked",
        value: (address) => address.last_checked_at ?? "",
        cell: (address) =>
          // Only a custom domain is checked: a name is the platform's own DNS.
          address.kind === "domain" ? (
            <RelativeTime at={address.last_checked_at} never="Not yet" />
          ) : (
            <span className="text-muted-foreground">Not checked</span>
          ),
      },
    ],
    [],
  )
  const filters = useMemo<DataFilter<PlatformPortalAddress>[]>(
    () => [
      {
        id: "state",
        label: "State",
        options: states.map((value) => ({ value, label: statusOf(value, "portal_address").label })),
        value: state ? [state] : [],
        onChange: (value) => url.set({ state: value[0] ?? null, page: null }),
      },
    ],
    [state, url],
  )

  return (
    <CollectionPage title="Portal addresses" description="Where billing accounts serve the portal under their own brand.">
      <DataTable
        id="admin-portal-addresses"
        label="Portal addresses"
        noun={["address", "addresses"]}
        rowKey={(address) => address.uuid}
        rowLabel={(address) => address.host}
        columns={columns}
        {...table}
        filters={filters}
        filtered={table.filtered || state !== null}
        onReset={() => url.clear(["search", "state", "page"])}
        rowActions={(address) => {
          const account = address.billing_account
          return (
            <>
              {account ? <DropdownMenuItem onSelect={() => navigate(billingAccountPath(account.uuid))}>Open billing account</DropdownMenuItem> : null}
              {account && (canSuspend(address) || address.state === "suspended") ? <DropdownMenuSeparator /> : null}
              {canSuspend(address) ? (
                <DropdownMenuItem variant="destructive" onSelect={() => suspension.suspend(address)}>
                  Suspend
                </DropdownMenuItem>
              ) : null}
              {address.state === "suspended" ? (
                <DropdownMenuItem disabled={suspension.busy} onSelect={() => void suspension.restore(address)}>
                  Restore
                </DropdownMenuItem>
              ) : null}
            </>
          )
        }}
        empty={
          <EmptyState
            inset
            icon={<GlobeIcon />}
            title="No portal addresses yet"
            description="A billing account allowed to brand claims a name, or a custom domain, on its Billing page."
          />
        }
      />
      {suspension.dialog}
    </CollectionPage>
  )
}
