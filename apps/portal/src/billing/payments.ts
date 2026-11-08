import type { InvoiceSummary } from "@iot-os/api-client"
import { toast } from "sonner"
import { api } from "../lib/api"

/** What can still be paid online: an issued invoice awaiting payment, or whose charge failed. */
export const payable = (invoice: InvoiceSummary) =>
  ["pending", "failed"].includes(invoice.payment_status) && invoice.outstanding > 0

/** Opens Stripe's page to pay what is still owed on an invoice. */
export async function payOnline(accountUuid: string, invoice: Pick<InvoiceSummary, "uuid" | "number">) {
  try {
    const { url } = await api.invoiceCheckout(accountUuid, invoice.uuid)
    window.location.assign(url)
  } catch {
    toast.error(`Could not open Stripe's page for ${invoice.number}. Try again.`)
  }
}
