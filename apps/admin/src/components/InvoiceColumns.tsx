import { useMemo } from "react"
import type { InvoiceSummary } from "@iot-os/api-client"
import { RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatMonth, paymentState } from "@iot-os/ui/lib/invoices"
import { formatMoney } from "@iot-os/ui/lib/money"
import { invoicePath } from "../lib/invoices"
import { billingAccountPath } from "../pages/BillingAccountsPage"

/** A draft is named by its month until it has a number. */
export const invoiceName = (invoice: Pick<InvoiceSummary, "number" | "month">) =>
  invoice.number ?? `Draft for ${formatMonth(invoice.month)}`

/** Invoice list columns; the account column is left out on an account's own page. */
export function useInvoiceColumns({ account = true }: { account?: boolean } = {}) {
  return useMemo<DataColumn<InvoiceSummary>[]>(
    () => [
      {
        id: "number",
        header: "Invoice",
        mobile: "title",
        value: (invoice) => invoice.number ?? "",
        cell: (invoice) => (
          <RefLink className="font-medium" to={invoicePath(invoice.uuid)}>
            {invoiceName(invoice)}
          </RefLink>
        ),
      },
      ...(account
        ? [
            {
              id: "account",
              header: "Billing account",
              value: (invoice: InvoiceSummary) => invoice.billing_account.name,
              cell: (invoice: InvoiceSummary) => (
                <RefLink to={billingAccountPath(invoice.billing_account.uuid)}>{invoice.billing_account.name}</RefLink>
              ),
            } satisfies DataColumn<InvoiceSummary>,
          ]
        : []),
      {
        id: "month",
        header: "Month",
        hideable: false,
        value: (invoice) => invoice.month,
        cell: (invoice) => formatMonth(invoice.month),
      },
      {
        id: "total",
        header: "Total",
        hideable: false,
        align: "end",
        value: (invoice) => invoice.total,
        cell: (invoice) => <span className="tabular-nums">{formatMoney(invoice.total, invoice.currency)}</span>,
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        hideable: false,
        value: (invoice) => paymentState(invoice) ?? invoice.status,
        cell: (invoice) => (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {invoice.status === "draft" ? (
              <Status value="draft" domain="invoice" />
            ) : (
              <Status value={paymentState(invoice)} domain="payment" />
            )}
            {invoice.status === "draft" && invoice.usage_incomplete ? <Status value="incomplete" domain="invoice" /> : null}
          </span>
        ),
      },
      {
        id: "when",
        header: "Issued or drafted",
        value: (invoice) => invoice.issued_at ?? invoice.drafted_at,
        cell: (invoice) => <RelativeTime at={invoice.issued_at ?? invoice.drafted_at} />,
      },
    ],
    [account],
  )
}
