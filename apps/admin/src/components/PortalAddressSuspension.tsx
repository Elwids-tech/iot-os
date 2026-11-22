import { useState } from "react"
import type { PlatformPortalAddress, PortalAddress } from "@iot-os/api-client"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Status, StatusMark } from "@iot-os/ui/components/status-mark"
import { formatDay } from "@iot-os/ui/lib/invoices"
import { ExternalLinkIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"

type Address = Pick<PortalAddress, "uuid" | "host" | "kind" | "state">

/** What a portal address's kind is called. */
export const addressKind = (address: Pick<PortalAddress, "kind">) => (address.kind === "domain" ? "Custom domain" : "Name")

/** Suspended addresses can be restored; released and lapsed ones are no longer held, so neither applies. */
export const canSuspend = (address: Pick<PortalAddress, "state">) => ["waiting_dns", "active", "unreachable"].includes(address.state)

/**
 * Suspending and restoring a portal address (spec 036 US6), for the Portal addresses
 * list and a billing account's Addresses panel. Suspending asks first: it stops the
 * portal there for everyone. Render `dialog` once.
 */
export function usePortalAddressSuspension(onChanged: (address: PlatformPortalAddress) => void) {
  const [suspending, setSuspending] = useState<Address | null>(null)
  const [busy, setBusy] = useState(false)

  async function suspend() {
    if (!suspending) return
    setBusy(true)
    try {
      const changed = await apiClient.suspendPortalAddress(suspending.uuid)
      toast.success(`${changed.host} suspended`)
      setSuspending(null)
      onChanged(changed)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function restore(address: Address) {
    setBusy(true)
    try {
      const changed = await apiClient.restorePortalAddress(address.uuid)
      // A custom domain whose DNS record went away waits for it again.
      toast.success(changed.state === "waiting_dns" ? `${changed.host} restored. It is waiting for its DNS record` : `${changed.host} restored`)
      onChanged(changed)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const dialog = (
    <AlertDialog open={suspending !== null} onOpenChange={(open) => !open && !busy && setSuspending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Suspend {suspending?.host}?</AlertDialogTitle>
          <AlertDialogDescription>
            Within a minute it shows only that the address is not in use: no brand and no sign-in.
            {suspending?.kind === "domain" ? " People signed in there are signed out." : ""} Its owners see it as suspended and
            cannot change, remove or restore it. You can restore it at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void suspend()}>
            {busy ? "Suspending…" : "Suspend address"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { suspend: setSuspending, restore, busy, dialog }
}

/** The host, opening the portal there in a new tab. */
export function AddressLink({ address }: { address: Pick<PortalAddress, "host" | "url"> }) {
  return (
    <a
      href={address.url}
      target="_blank"
      rel="noreferrer"
      className="relative z-10 inline-flex min-w-0 items-center gap-1 font-medium underline-offset-4 hover:underline"
    >
      <span className="truncate">{address.host}</span>
      <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
  )
}

/**
 * An address's state, and beside it why one whose state serves does not: its account's
 * allowance is off, which stops the address without changing its state (FR-037). Also
 * a custom domain whose certificate is close to expiring or has expired, the day an
 * address without its allowance is given up, and when a lapsed request lapsed.
 */
export function AddressState({
  address,
  serving,
}: {
  address: Pick<PortalAddress, "state" | "certificate_expiring" | "releases_at" | "lapsed_at">
  serving: boolean
}) {
  const stopped = !serving && (address.state === "active" || address.state === "unreachable")

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Status value={address.state} domain="portal_address" />
      {stopped ? <StatusMark tone="muted">Allowance off</StatusMark> : null}
      {/* Suspended or waiting, it is still given up when the allowance stays off. */}
      {address.releases_at ? <span className="text-meta text-muted-foreground">Given up on {formatDay(address.releases_at)}</span> : null}
      {address.state === "lapsed" && address.lapsed_at ? (
        <span className="text-meta text-muted-foreground">
          <RelativeTime at={address.lapsed_at} />
        </span>
      ) : null}
      {/* Renewal is overdue: the proxy renews a month ahead, so this is a failure to look into. */}
      {address.certificate_expiring ? <StatusMark tone="warning">Certificate expiring</StatusMark> : null}
    </span>
  )
}
