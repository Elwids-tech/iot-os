import { useCallback, useEffect, useMemo, useState } from "react"
import type { BillingAccountDetail, Branding, PortalAddress } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { AlertCircleIcon, GlobeIcon, InfoIcon } from "lucide-react"
import { apiClient } from "../lib/api-client"
import { useAddressEditing } from "./AddressEditing"
import { AddressLink, AddressState, addressKind, canSuspend, usePortalAddressSuspension } from "./PortalAddressSuspension"

/**
 * A billing account's portal addresses for platform staff (spec 036 US6): their state,
 * Suspend and Restore, and what its owners do in the portal, on their behalf: claim or
 * change the name, add a custom domain, check it and remove either.
 */
export function AddressesPanel({ account }: { account: Pick<BillingAccountDetail, "uuid" | "name" | "allowances"> }) {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [failed, setFailed] = useState(false)
  // The switches are changed in the Allowances panel above; an address serves only while they are on.
  const on = (kind: string) => account.allowances.find((allowance) => allowance.kind === kind)?.value === 1
  const allowed = on("branding")
  const domainAllowed = on("custom_domain")

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setBranding(await apiClient.branding(account.uuid, true))
    } catch {
      setFailed(true)
    }
  }, [account.uuid])
  useEffect(() => void load(), [load, allowed, domainAllowed])
  const suspension = usePortalAddressSuspension(() => void load())
  const editing = useAddressEditing(account, branding, () => void load())

  const columns = useMemo<DataColumn<PortalAddress>[]>(
    () => [
      {
        id: "address",
        header: "Address",
        mobile: "title",
        value: (address) => address.host,
        cell: (address) => (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <AddressLink address={address} />
            {address.main ? <Badge variant="secondary">Main address</Badge> : null}
          </span>
        ),
      },
      {
        id: "kind",
        header: "Kind",
        value: (address) => addressKind(address),
        cell: (address) => addressKind(address),
      },
      {
        id: "state",
        header: "State",
        mobile: "badge",
        hideable: false,
        value: (address) => address.state,
        cell: (address) => <AddressState address={address} serving={allowed && (address.kind !== "domain" || domainAllowed)} />,
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
    [allowed, domainAllowed],
  )
  const addresses = branding?.addresses ?? []
  const unavailable = branding !== null && !branding.addresses_available
  const stopped = branding !== null && branding.addresses_available && !allowed && addresses.length > 0
  const live = addresses.filter((address) => address.state !== "lapsed")
  const canEdit = branding !== null && branding.addresses_available
  const busy = suspension.busy || editing.busy

  return (
    <Panel aria-labelledby="billing-addresses">
      <PanelHeader>
        <PanelTitle id="billing-addresses">Addresses</PanelTitle>
        <PanelDescription>
          Where {account.name}&apos;s people open the portal under its brand. Its owners claim and remove them in the portal; you can do
          the same for them here.
        </PanelDescription>
        {canEdit && live.length < 2 ? (
          <PanelActions>
            {live.some((address) => address.kind === "name") ? null : (
              <Button size="sm" variant="outline" onClick={() => editing.claimName(null)}>
                Claim name
              </Button>
            )}
            {live.some((address) => address.kind === "domain") ? null : (
              <Button size="sm" variant="outline" onClick={() => editing.addDomain()}>
                Add domain
              </Button>
            )}
          </PanelActions>
        ) : null}
      </PanelHeader>
      {failed || unavailable || stopped ? (
        <PanelContent className="flex flex-col gap-4">
          {failed ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>
                Could not load the addresses.
                <Button variant="outline" size="sm" className="mt-2 self-start" onClick={() => void load()}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {unavailable ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Addresses are not available on this deployment</AlertTitle>
              <AlertDescription>A brand still shows inside the portal at its usual address.</AlertDescription>
            </Alert>
          ) : null}
          {stopped ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Branding is off, so these addresses do not open the portal</AlertTitle>
              <AlertDescription>They are kept as they are and work again when Branding is turned back on under Allowances.</AlertDescription>
            </Alert>
          ) : null}
        </PanelContent>
      ) : null}
      {failed ? null : (
        <PanelContent flush>
          <DataTable
            id="admin-billing-account-addresses"
            label="Addresses"
            noun={["address", "addresses"]}
            rowKey={(address) => address.uuid}
            rowLabel={(address) => address.host}
            columns={columns}
            rows={branding?.addresses}
            rowActions={(address) =>
              // A lapsed request is no longer held: there is nothing to act on.
              address.state === "lapsed" ? null : (
                <>
                  {address.kind === "name" ? (
                    <DropdownMenuItem onSelect={() => editing.claimName(address)}>Change name</DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onSelect={() => editing.showRecord(address)}>DNS record</DropdownMenuItem>
                      {address.state === "suspended" ? null : (
                        <DropdownMenuItem disabled={busy} onSelect={() => void editing.check(address)}>
                          Check now
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {address.state === "suspended" ? (
                    <DropdownMenuItem disabled={busy} onSelect={() => void suspension.restore(address)}>
                      Restore
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  {canSuspend(address) ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => suspension.suspend(address)}>
                      Suspend
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem variant="destructive" onSelect={() => editing.remove(address)}>
                    Remove
                  </DropdownMenuItem>
                </>
              )
            }
            empty={
              <EmptyState
                inset
                icon={<GlobeIcon />}
                title="No addresses"
                description="An owner claims a name, or a custom domain, on the account's Billing page in the portal. You can claim one for them above."
              />
            }
          />
        </PanelContent>
      )}
      {suspension.dialog}
      {editing.dialogs}
    </Panel>
  )
}
