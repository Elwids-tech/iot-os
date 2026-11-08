import { useCallback, useEffect, useMemo, useState } from "react"
import { ApiError, type CreditNote, type InvoiceDetail, type InvoiceLine, type InvoicePayment } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
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
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { keepToastsAbove } from "@iot-os/ui/components/sonner"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatDay, formatMonth, paymentState } from "@iot-os/ui/lib/invoices"
import { statusOf } from "@iot-os/ui/lib/status"
import { formatBasisPoints, formatMoney } from "@iot-os/ui/lib/money"
import { EntityPage, PropertyList } from "@iot-os/ui/templates/entity-page"
import { AlertCircleIcon, DownloadIcon, ReceiptTextIcon } from "lucide-react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { CreditNoteDialog, creditable } from "../components/CreditNoteDialog"
import { InvoiceAdjustmentDialog } from "../components/InvoiceAdjustmentDialog"
import { RecordPaymentDialog } from "../components/RecordPaymentDialog"
import { invoiceName } from "../components/InvoiceColumns"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"
import { invoiceHistoryText } from "../lib/invoices"
import { billingAccountPath } from "./BillingAccountsPage"

const back = { to: "/billing/invoices", label: "Invoices" }

const usageKinds = { alerts: "Alerts", sms: "SMS", data_points: "Data points" } as const

/** How a payment was made, in words. */
export function paymentMethodText(payment: Pick<InvoicePayment, "method" | "attempt">): string {
  if (payment.method === "outside") return "Recorded by hand"
  if (payment.method === "checkout") return "Paid on Stripe's page"
  return payment.attempt > 1 ? `Card, attempt ${payment.attempt}` : "Card, charged at issue"
}

type UsageRow = InvoiceDetail["usage"][number]

/**
 * One invoice (spec 029 US6, US7): its lines, each organization's usage, its credit
 * notes, payments and history. A draft can be recalculated, adjusted and issued; an
 * issued invoice never changes and takes credit notes and payments instead.
 */
export function InvoicePage() {
  const { invoiceUuid = "" } = useParams()
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [failure, setFailure] = useState<"not_found" | "failed" | null>(null)
  const [busy, setBusy] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [crediting, setCrediting] = useState(false)
  const [recording, setRecording] = useState(false)

  const load = useCallback(() => {
    setFailure(null)
    apiClient
      .adminInvoice(invoiceUuid)
      .then(setInvoice)
      .catch((error) => setFailure(error instanceof ApiError && error.status === 404 ? "not_found" : "failed"))
  }, [invoiceUuid])

  useEffect(() => {
    setInvoice(null)
    load()
  }, [load])

  const currency = invoice?.currency ?? "USD"
  const draft = invoice?.status === "draft"

  async function act(action: () => Promise<InvoiceDetail>, success: (saved: InvoiceDetail) => string) {
    setBusy(true)
    try {
      const saved = await action()
      setInvoice(saved)
      toast.success(success(saved))
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      // Someone else may have issued it: show what is there now.
      if (error instanceof ApiError && error.status === 409) load()
      return false
    } finally {
      setBusy(false)
    }
  }

  const lineColumns = useMemo<DataColumn<InvoiceLine>[]>(
    () => [
      {
        id: "description",
        header: "Description",
        mobile: "title",
        value: (line) => line.description,
        cell: (line) => <span className="min-w-0 break-words">{line.description}</span>,
      },
      {
        id: "quantity",
        header: "Quantity",
        hideable: false,
        align: "end",
        value: (line) => line.quantity,
        cell: (line) => <span className="tabular-nums">{line.quantity.toLocaleString()}</span>,
      },
      {
        id: "unit_price",
        header: "Unit price",
        hideable: false,
        align: "end",
        value: (line) => line.unit_price ?? "",
        cell: (line) =>
          line.unit_price === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">{formatMoney(line.unit_price, currency)}</span>
          ),
      },
      {
        id: "amount",
        header: "Amount",
        hideable: false,
        align: "end",
        value: (line) => line.amount,
        cell: (line) => <span className="tabular-nums">{formatMoney(line.amount, currency)}</span>,
      },
      {
        id: "note",
        header: "Note",
        value: (line) => line.note ?? "",
        cell: (line) =>
          line.note ? <span className="min-w-0 break-words text-muted-foreground">{line.note}</span> : <span className="text-muted-foreground">—</span>,
      },
    ],
    [currency],
  )

  const usageColumns = useMemo<DataColumn<UsageRow>[]>(
    () => [
      {
        id: "organization",
        header: "Organization",
        mobile: "title",
        value: (row) => row.organization_name,
        cell: (row) => <span className="font-medium">{row.organization_name}</span>,
      },
      {
        id: "kind",
        header: "Usage",
        hideable: false,
        value: (row) => usageKinds[row.kind],
        cell: (row) => usageKinds[row.kind],
      },
      {
        id: "count",
        header: "Count",
        hideable: false,
        align: "end",
        value: (row) => row.count,
        cell: (row) => <span className="tabular-nums">{row.count.toLocaleString()}</span>,
      },
    ],
    [],
  )

  const creditColumns = useMemo<DataColumn<CreditNote>[]>(
    () => [
      {
        id: "number",
        header: "Credit note",
        mobile: "title",
        value: (note) => note.number,
        cell: (note) => (
          <a className="font-medium underline-offset-4 hover:underline" href={apiClient.adminCreditNotePdfUrl(note.uuid)} download>
            {note.number}
          </a>
        ),
      },
      {
        id: "amount",
        header: "Amount",
        hideable: false,
        align: "end",
        value: (note) => note.amount,
        cell: (note) => <span className="tabular-nums">{formatMoney(note.amount, currency)}</span>,
      },
      {
        id: "applied",
        header: "Off this invoice",
        hideable: false,
        align: "end",
        value: (note) => note.applied,
        cell: (note) => <span className="tabular-nums">{formatMoney(note.applied, currency)}</span>,
      },
      {
        id: "reason",
        header: "Reason",
        value: (note) => note.reason,
        cell: (note) => <span className="min-w-0 break-words">{note.reason}</span>,
      },
      {
        id: "issued",
        header: "Issued",
        hideable: false,
        value: (note) => note.issued_at,
        cell: (note) => <RelativeTime at={note.issued_at} />,
      },
    ],
    [currency],
  )

  const paymentColumns = useMemo<DataColumn<InvoicePayment>[]>(
    () => [
      {
        id: "method",
        header: "Payment",
        mobile: "title",
        value: (payment) => paymentMethodText(payment),
        cell: (payment) => <span className="font-medium">{paymentMethodText(payment)}</span>,
      },
      {
        id: "amount",
        header: "Amount",
        hideable: false,
        align: "end",
        value: (payment) => payment.amount,
        cell: (payment) => <span className="tabular-nums">{formatMoney(payment.amount, currency)}</span>,
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        hideable: false,
        value: (payment) => payment.status,
        cell: (payment) => <Status value={payment.status} domain="invoice_payment" />,
      },
      {
        id: "detail",
        header: "Reason or note",
        value: (payment) => payment.failure_reason ?? payment.note ?? "",
        cell: (payment) =>
          (payment.failure_reason ?? payment.note) ? (
            <span className="min-w-0 break-words">{payment.failure_reason ?? payment.note}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "at",
        header: "When",
        hideable: false,
        value: (payment) => payment.at,
        cell: (payment) => <RelativeTime at={payment.at} />,
      },
    ],
    [currency],
  )

  if (failure) {
    return (
      <>
        <PageHeader title="Invoice" back={back} />
        <div className="p-4 md:p-6">
          {failure === "not_found" ? (
            <EmptyState icon={<ReceiptTextIcon />} title="Invoice not found" description="A draft is deleted with its billing account. Go back to Invoices to find another." />
          ) : (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load this invoice</AlertTitle>
              <AlertDescription>Go back to Invoices and try again.</AlertDescription>
            </Alert>
          )}
        </div>
      </>
    )
  }

  if (!invoice) {
    return (
      <>
        <PageHeader title="Invoice" back={back} />
        <div className="flex flex-col gap-3 p-4 md:p-6" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </>
    )
  }

  const money = (amount: number) => formatMoney(amount, currency)
  const left = creditable(invoice)
  // Stripe can settle a charge or Checkout payment still processing.
  const checkable = invoice.payments.some((payment) => payment.status === "pending" && payment.method !== "outside")
  const details = invoice.account_details
  const operator = invoice.operator_details

  return (
    <>
      <EntityPage
        title={invoiceName(invoice)}
        icon={<ReceiptTextIcon />}
        back={back}
        status={
          <>
            {draft ? <Status value="draft" domain="invoice" /> : <Status value={paymentState(invoice)} domain="payment" />}
            {draft && invoice.usage_incomplete ? <Status value="incomplete" domain="invoice" /> : null}
            <span className="text-muted-foreground">
              <RefLink to={billingAccountPath(invoice.billing_account.uuid)}>{invoice.billing_account.name}</RefLink> ·{" "}
              {formatMonth(invoice.month)}
            </span>
          </>
        }
        notices={
          draft && invoice.usage_incomplete ? (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>Drafted before the month&apos;s usage was final</AlertTitle>
              <AlertDescription>
                {invoice.draft_note ? `${invoice.draft_note}. ` : ""}Recalculate once the runtime has reported the whole month;
                until then the invoice says its usage may be incomplete.
              </AlertDescription>
            </Alert>
          ) : null
        }
        rail={
          <>
            <Panel aria-labelledby="invoice-totals">
              <PanelHeader>
                <PanelTitle id="invoice-totals">Totals</PanelTitle>
              </PanelHeader>
              <PanelContent>
                <PropertyList
                  items={[
                    { label: "Subtotal", value: <span className="tabular-nums">{money(invoice.subtotal)}</span> },
                    {
                      label: "Tax",
                      value: (
                        <span className="tabular-nums">
                          {money(invoice.tax)}
                          {invoice.tax_rate_name ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {invoice.tax_rate_name}
                              {invoice.tax_basis_points !== null ? ` ${formatBasisPoints(invoice.tax_basis_points)}` : ""}
                            </span>
                          ) : null}
                        </span>
                      ),
                    },
                    { label: "Total", value: <span className="font-medium tabular-nums">{money(invoice.total)}</span> },
                    ...(invoice.credit_applied
                      ? [{ label: "Account credit", value: <span className="tabular-nums">{money(-invoice.credit_applied)}</span> }]
                      : []),
                    { label: "Amount due", value: <span className="tabular-nums">{money(invoice.amount_due)}</span> },
                    ...(draft
                      ? []
                      : [
                          { label: "Still owed", value: <span className="tabular-nums">{money(invoice.outstanding)}</span> },
                          { label: "Due", value: invoice.due_at ? formatDay(invoice.due_at) : "—" },
                          { label: "Issued", value: <RelativeTime at={invoice.issued_at} /> },
                        ]),
                    { label: "Drafted", value: <RelativeTime at={invoice.drafted_at} /> },
                  ]}
                />
              </PanelContent>
            </Panel>
            <Panel aria-labelledby="invoice-parties">
              <PanelHeader>
                <PanelTitle id="invoice-parties">Billed to</PanelTitle>
                <PanelDescription>{draft ? "As the account is now; fixed when issued." : "As it was when issued."}</PanelDescription>
              </PanelHeader>
              <PanelContent className="flex flex-col gap-3">
                <div className="min-w-0 break-words">
                  <p className="font-medium">{details.name}</p>
                  {details.billing_address ? <p className="whitespace-pre-wrap">{details.billing_address}</p> : null}
                  {details.tax_number ? <p className="text-muted-foreground">Tax number {details.tax_number}</p> : null}
                  {details.contact_email ? <p className="text-muted-foreground">{details.contact_email}</p> : null}
                </div>
                {operator ? (
                  <div className="min-w-0 break-words border-t pt-3">
                    <p className="text-meta text-muted-foreground">From</p>
                    <p className="font-medium">{operator.legal_name ?? "—"}</p>
                    {operator.address ? <p className="whitespace-pre-wrap">{operator.address}</p> : null}
                    {operator.tax_registration_number ? (
                      <p className="text-muted-foreground">Tax registration {operator.tax_registration_number}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="border-t pt-3 text-meta text-muted-foreground">The operator&apos;s details come from Settings → Billing when it is issued.</p>
                )}
              </PanelContent>
            </Panel>
          </>
        }
      >
        <Panel aria-labelledby="invoice-lines">
          <PanelHeader>
            <PanelTitle id="invoice-lines">Lines</PanelTitle>
            <PanelDescription>
              {draft ? "Recalculating rebuilds them from the records and keeps adjustments." : "Fixed when it was issued."}
            </PanelDescription>
          </PanelHeader>
          <PanelContent flush>
            <DataTable
              id="admin-invoice-lines"
              label="Lines"
              noun={["line", "lines"]}
              rowKey={(line) => String(line.id)}
              rowLabel={(line) => line.description}
              columns={lineColumns}
              rows={invoice.lines}
              rowActions={
                draft
                  ? (line) =>
                      line.kind === "adjustment" ? (
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() =>
                            void act(() => apiClient.removeInvoiceAdjustment(invoice.uuid, line.id), () => `Removed “${line.description}”`)
                          }
                        >
                          Remove adjustment
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled>Only adjustments can be removed</DropdownMenuItem>
                      )
                  : undefined
              }
              empty={
                <EmptyState inset icon={<ReceiptTextIcon />} title="No lines" description="The account had no plan with prices this month." />
              }
            />
          </PanelContent>
        </Panel>
        <Panel aria-labelledby="invoice-usage">
          <PanelHeader>
            <PanelTitle id="invoice-usage">Usage by organization</PanelTitle>
            <PanelDescription>What each organization counted in {formatMonth(invoice.month)}.</PanelDescription>
          </PanelHeader>
          <PanelContent flush>
            <DataTable
              id="admin-invoice-usage"
              label="Usage by organization"
              noun={["row", "rows"]}
              rowKey={(row) => `${row.organization_uuid}-${row.kind}`}
              rowLabel={(row) => `${row.organization_name} ${usageKinds[row.kind]}`}
              columns={usageColumns}
              rows={invoice.usage}
              empty={<EmptyState inset icon={<ReceiptTextIcon />} title="No usage" description="Nothing was counted this month." />}
            />
          </PanelContent>
        </Panel>
        {draft ? null : (
          <Panel aria-labelledby="invoice-credit-notes">
            <PanelHeader>
              <PanelTitle id="invoice-credit-notes">Credit notes</PanelTitle>
              <PanelDescription>
                Each takes what it can off what is owed here; the rest comes off the account&apos;s next invoice.
              </PanelDescription>
            </PanelHeader>
            <PanelContent flush>
              <DataTable
                id="admin-invoice-credit-notes"
                label="Credit notes"
                noun={["credit note", "credit notes"]}
                rowKey={(note) => note.uuid}
                rowLabel={(note) => note.number}
                columns={creditColumns}
                rows={invoice.credit_notes}
                empty={<EmptyState inset icon={<ReceiptTextIcon />} title="No credit notes" description="Issue one if this invoice was wrong." />}
              />
            </PanelContent>
          </Panel>
        )}
        {draft ? null : (
          <Panel aria-labelledby="invoice-payments">
            <PanelHeader>
              <PanelTitle id="invoice-payments">Payments</PanelTitle>
              <PanelDescription>
                Card charges are tried at issue, on the due date and a week after. Payments made another way are recorded here.
              </PanelDescription>
            </PanelHeader>
            <PanelContent flush>
              <DataTable
                id="admin-invoice-payments"
                label="Payments"
                noun={["payment", "payments"]}
                rowKey={(payment) => payment.uuid}
                rowLabel={(payment) => paymentMethodText(payment)}
                columns={paymentColumns}
                rows={invoice.payments}
                empty={
                  <EmptyState
                    inset
                    icon={<ReceiptTextIcon />}
                    title="No payments yet"
                    description="Record one made another way, such as a bank transfer."
                  />
                }
              />
            </PanelContent>
          </Panel>
        )}
        <Panel aria-labelledby="invoice-history">
          <PanelHeader>
            <PanelTitle id="invoice-history">History</PanelTitle>
            <PanelDescription>Newest first.</PanelDescription>
          </PanelHeader>
          <PanelContent>
            {invoice.history.length ? (
              <ol className="divide-y">
                {invoice.history.map((entry, index) => (
                  <li key={`${entry.at}-${entry.action}-${index}`} className="flex flex-wrap items-baseline gap-x-2 py-2 first:pt-0">
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium">{entry.actor?.name ?? "System"}</span> · {invoiceHistoryText(entry, currency)}
                    </span>
                    <RelativeTime at={entry.at} className="text-meta text-muted-foreground" />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground">No history yet.</p>
            )}
          </PanelContent>
        </Panel>
      </EntityPage>
      <div ref={keepToastsAbove} className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3 md:px-6">
        <p className="mr-auto text-body" aria-live="polite">
          {draft ? (
            <>
              Draft · <span className="tabular-nums">{money(invoice.amount_due)}</span> due{" "}
              <span className="text-muted-foreground">· not sent until issued</span>
            </>
          ) : (
            <>
              {invoice.number} · <span className="tabular-nums">{money(invoice.outstanding)}</span> still owed
            </>
          )}
        </p>
        <Button asChild size="sm" variant="ghost">
          <a href={apiClient.adminInvoiceDocumentUrl(invoice.uuid, "pdf")} download>
            <DownloadIcon data-icon="inline-start" />
            PDF
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={apiClient.adminInvoiceDocumentUrl(invoice.uuid, "csv")} download>
            <DownloadIcon data-icon="inline-start" />
            CSV
          </a>
        </Button>
        {draft ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => apiClient.recalculateInvoice(invoice.uuid), () => "Recalculated from the records")}
            >
              Recalculate
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAdjusting(true)}>
              Add adjustment
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setIssuing(true)}>
              Issue
            </Button>
          </>
        ) : (
          <>
            {checkable ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => apiClient.reconcileInvoice(invoice.uuid), (saved) => `Checked with Stripe: ${statusOf(paymentState(saved), "payment").label.toLowerCase()}`)}
              >
                Check with Stripe
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={busy || invoice.outstanding <= 0} onClick={() => setRecording(true)}>
              Record payment
            </Button>
            <Button size="sm" variant="outline" disabled={busy || left <= 0} onClick={() => setCrediting(true)}>
              {left <= 0 ? "Fully credited" : "Credit note"}
            </Button>
          </>
        )}
      </div>
      <InvoiceAdjustmentDialog invoice={invoice} open={adjusting} onClose={() => setAdjusting(false)} onSaved={setInvoice} />
      <CreditNoteDialog invoice={invoice} open={crediting} onClose={() => setCrediting(false)} onIssued={load} />
      <RecordPaymentDialog invoice={invoice} open={recording} onClose={() => setRecording(false)} onSaved={setInvoice} />
      <AlertDialog open={issuing} onOpenChange={(open) => !open && !busy && setIssuing(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Issue the {formatMonth(invoice.month)} invoice for {invoice.billing_account.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It takes the next invoice number and cannot be changed after; mistakes are corrected with a credit note. It is
              emailed at once to the billing contact and each owner with {money(invoice.amount_due)} due.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await act(() => apiClient.issueInvoice(invoice.uuid), (saved) => `Issued as ${saved.number} and emailed`)) setIssuing(false)
              }}
            >
              {busy ? "Issuing…" : "Issue invoice"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
