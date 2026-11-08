import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { OwnedBillingAccount } from "@iot-os/api-client"
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
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { formatMonth } from "@iot-os/ui/lib/invoices"
import { CreditCardIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { billingAccountsKey } from "./model"

/** "Visa •••• 4242", or the brand alone. */
export const cardName = (card: NonNullable<OwnedBillingAccount["payment_method"]>) =>
  `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)}${card.last_four ? ` •••• ${card.last_four}` : ""}`

/**
 * The account's card (spec 029 US7): its brand, last four digits and expiry, never more.
 * Adding or replacing it happens on Stripe's page, so card numbers never reach the
 * platform; the page comes back to Billing accounts. Hidden while payments are off.
 */
export function PaymentMethodPanel({ account, saving }: { account: OwnedBillingAccount; saving: boolean }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const card = account.payment_method

  if (!account.payments_enabled) return null

  async function openStripe() {
    setBusy(true)
    try {
      const { url } = await api.paymentMethodCheckout(account.uuid)
      window.location.assign(url)
    } catch {
      toast.error("Could not open Stripe's page. Try again.")
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.removePaymentMethod(account.uuid)
      toast.success("Card removed")
      setRemoving(false)
      await queryClient.invalidateQueries({ queryKey: billingAccountsKey })
    } catch {
      toast.error("Could not remove the card. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel aria-labelledby="billing-card">
      <PanelHeader>
        <PanelTitle id="billing-card">Card</PanelTitle>
        <PanelDescription>
          {card
            ? "Each invoice is charged to it when it is issued, and again on the due date if that fails."
            : "Save a card and each invoice is charged to it when it is issued. Without one, pay each invoice online."}
        </PanelDescription>
        <PanelActions>
          <Button size="sm" variant={card ? "outline" : "default"} disabled={busy} onClick={() => void openStripe()}>
            <CreditCardIcon data-icon="inline-start" />
            {card ? "Replace card" : "Add card"}
          </Button>
          {card ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoving(true)}>
              Remove
            </Button>
          ) : null}
        </PanelActions>
      </PanelHeader>
      <PanelContent>
        {card ? (
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium tabular-nums">{cardName(card)}</span>
            {card.expires ? <span className="text-meta text-muted-foreground">Expires {formatMonth(card.expires)}</span> : null}
          </p>
        ) : saving ? (
          <p className="text-muted-foreground" aria-live="polite">
            Saving your card. Stripe is confirming it…
          </p>
        ) : (
          <p className="text-muted-foreground">No card saved. Card details are entered on Stripe&apos;s page only.</p>
        )}
      </PanelContent>
      <AlertDialog open={removing} onOpenChange={(open) => !open && !busy && setRemoving(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {card ? cardName(card) : "the card"}?</AlertDialogTitle>
            <AlertDialogDescription>
              New invoices are no longer charged to it. You can still pay each one online, or add a card again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep card</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove card"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  )
}
