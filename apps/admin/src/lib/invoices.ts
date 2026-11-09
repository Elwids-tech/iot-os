import type { InvoiceHistoryEntry, PriceKind } from "@iot-os/api-client"
import { formatMoney } from "@iot-os/ui/lib/money"

export const invoicePath = (uuid: string) => `/billing/invoices/${encodeURIComponent(uuid)}`

export const priceKinds: PriceKind[] = ["base_price", "alert_overage_price", "data_point_overage_price"]

/** How each price reads in forms and tables (spec 029 FR-027). */
export const priceText: Record<PriceKind, { label: string; help: string }> = {
  base_price: {
    label: "Base price",
    help: "A month on the plan. A part month is charged by the day.",
  },
  alert_overage_price: {
    label: "Per alert over the allowance",
    help: "Each alert past the alert allowance in a month.",
  },
  data_point_overage_price: {
    label: "Per block of data points over the allowance",
    help: "Each block, or part of one, past the data point allowance in a month.",
  },
}

/** The first day of next UTC month, `YYYY-MM-DD`: when price changes apply (FR-028). */
export function nextMonthStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

/** One invoice history line in words, without the actor or the time. */
export function invoiceHistoryText(entry: InvoiceHistoryEntry, currency: string): string {
  const amount = entry.amount === null ? "" : formatMoney(entry.amount, currency)
  const why = entry.note ? `: ${entry.note}` : ""
  switch (entry.action) {
    case "drafted":
      return `Drafted it${why}`
    case "recalculated":
      return "Recalculated it from the records"
    case "adjustment_added":
      return `Added “${entry.description ?? "an adjustment"}”, ${amount}${why}`
    case "adjustment_removed":
      return `Removed “${entry.description ?? "an adjustment"}”, ${amount}`
    case "issued":
      return `Issued it as ${entry.number ?? "an invoice"}`
    case "credit_note_issued":
      return `Issued credit note ${entry.number ?? ""} for ${amount}${why}`
    case "payment_recorded":
      return `Recorded a payment of ${amount}${why}`
    case "payment_succeeded":
      return `Received a payment of ${amount}`
    case "payment_failed":
      return `A payment of ${amount} failed${why}`
    case "payment_amount_mismatch":
      return `Received ${amount}, not the amount charged; check the payments`
    case "overpaid":
      return `Paid ${amount} more than was owed; it became account credit for the next invoice`
  }
}
