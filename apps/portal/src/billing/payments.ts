import type { InvoiceSummary } from "@iot-os/api-client"
import { toast } from "sonner"
import { api } from "../lib/api"

/**
 * What can still be paid online: an issued invoice awaiting payment, or whose charge
 * failed, with no payment Stripe has yet to answer.
 */
export const payable = (invoice: InvoiceSummary) =>
  ["pending", "failed"].includes(invoice.payment_status) && invoice.outstanding > 0 && !invoice.payment_processing

/** Opens Stripe's page to pay what is still owed on an invoice. */
export async function payOnline(accountUuid: string, invoice: Pick<InvoiceSummary, "uuid" | "number">) {
  try {
    const { url } = await api.invoiceCheckout(accountUuid, invoice.uuid)
    window.location.assign(url)
  } catch {
    toast.error(`Could not open Stripe's page for ${invoice.number}. Try again.`)
  }
}

/** Opens Stripe's page to save a card; it comes back to Billing accounts. False when it could not open. */
export async function addCard(accountUuid: string): Promise<boolean> {
  try {
    const { url } = await api.paymentMethodCheckout(accountUuid)
    window.location.assign(url)
    return true
  } catch {
    toast.error("Could not open Stripe's page. Try again.")
    return false
  }
}
