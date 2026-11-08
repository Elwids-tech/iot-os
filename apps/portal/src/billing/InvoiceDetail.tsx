import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@iot-os/ui/components/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@iot-os/ui/components/sheet"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatDay, formatMonth, paymentState } from "@iot-os/ui/lib/invoices"
import { formatBasisPoints, formatMoney } from "@iot-os/ui/lib/money"
import { DownloadIcon } from "lucide-react"
import { LoadError } from "../components/forms"
import { api } from "../lib/api"
import { payable, payOnline } from "./payments"

const usageKinds = { alerts: "Alerts", sms: "SMS", data_points: "Data points" } as const

const paymentLabels = { card: "Card", checkout: "Paid online", outside: "Paid another way" } as const

/**
 * One issued invoice for an owner (spec 029 FR-036, US7), opened by `?invoice=`, as the
 * emails link it: its lines, totals, credit notes, payments and each organization's
 * usage, with the PDF to print or keep and the CSV. An unpaid one offers **Pay**, on
 * Stripe's page, focused so the email's reader can pay at once. Drafts and other
 * accounts' invoices are never shown.
 */
export function InvoiceDetail({
  accountUuid,
  invoiceUuid,
  paymentsEnabled,
  onClose,
}: {
  accountUuid: string
  invoiceUuid: string | null
  paymentsEnabled: boolean
  onClose: () => void
}) {
  const payButton = useRef<HTMLButtonElement>(null)
  const [opening, setOpening] = useState(false)
  const invoice = useQuery({
    queryKey: ["billing-accounts", accountUuid, "invoices", invoiceUuid],
    queryFn: () => api.ownedInvoice(accountUuid, invoiceUuid ?? ""),
    enabled: invoiceUuid !== null,
  })
  const data = invoice.data
  const money = (amount: number) => formatMoney(amount, data?.currency ?? "USD")
  const canPay = paymentsEnabled && data !== undefined && payable(data)

  useEffect(() => {
    if (canPay) payButton.current?.focus()
  }, [canPay])

  async function pay() {
    if (!data) return
    setOpening(true)
    await payOnline(accountUuid, data)
    setOpening(false)
  }

  return (
    <Sheet open={invoiceUuid !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data ? `Invoice ${data.number}` : "Invoice"}</SheetTitle>
          <SheetDescription>{data ? `${data.account_details.name} · ${formatMonth(data.month)}` : "Loading the invoice"}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          {invoice.error ? (
            <LoadError error={invoice.error} what="this invoice" onRetry={() => invoice.refetch()} busy={invoice.isFetching} />
          ) : !data ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Status value={paymentState(data)} domain="payment" />
                {data.due_at ? <span className="text-muted-foreground">Due {formatDay(data.due_at)}</span> : null}
                <span className="ml-auto flex gap-2">
                  {canPay ? (
                    <Button ref={payButton} size="sm" disabled={opening} onClick={() => void pay()}>
                      Pay {money(data.outstanding)}
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <a href={api.ownedInvoiceDocumentUrl(accountUuid, data.uuid, "pdf")} download>
                      <DownloadIcon data-icon="inline-start" />
                      PDF
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={api.ownedInvoiceDocumentUrl(accountUuid, data.uuid, "csv")} download>
                      <DownloadIcon data-icon="inline-start" />
                      CSV
                    </a>
                  </Button>
                </span>
              </div>
              <section aria-labelledby="invoice-lines-heading" className="flex flex-col gap-2">
                <h3 id="invoice-lines-heading" className="text-heading">
                  Lines
                </h3>
                <ul className="divide-y">
                  {data.lines.map((line) => (
                    <li key={line.id} className="flex items-baseline gap-4 py-2">
                      <span className="min-w-0 flex-1 break-words">
                        {line.description}
                        {line.unit_price !== null ? (
                          <span className="block text-meta text-muted-foreground">
                            {line.quantity.toLocaleString()} × {money(line.unit_price)}
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums">{money(line.amount)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t pt-2">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="text-right tabular-nums">{money(data.subtotal)}</dd>
                  <dt className="text-muted-foreground">
                    Tax
                    {data.tax_rate_name
                      ? ` · ${data.tax_rate_name}${data.tax_basis_points !== null ? ` ${formatBasisPoints(data.tax_basis_points)}` : ""}`
                      : ""}
                  </dt>
                  <dd className="text-right tabular-nums">{money(data.tax)}</dd>
                  <dt className="font-medium">Total</dt>
                  <dd className="text-right font-medium tabular-nums">{money(data.total)}</dd>
                  {data.credit_applied ? (
                    <>
                      <dt className="text-muted-foreground">Account credit</dt>
                      <dd className="text-right tabular-nums">{money(-data.credit_applied)}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Amount due</dt>
                  <dd className="text-right tabular-nums">{money(data.amount_due)}</dd>
                  <dt className="text-muted-foreground">Still owed</dt>
                  <dd className="text-right tabular-nums">{money(data.outstanding)}</dd>
                </dl>
              </section>
              {data.credit_notes.length ? (
                <section aria-labelledby="invoice-credit-heading" className="flex flex-col gap-2">
                  <h3 id="invoice-credit-heading" className="text-heading">
                    Credit notes
                  </h3>
                  <ul className="divide-y">
                    {data.credit_notes.map((note) => (
                      <li key={note.uuid} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                        <a className="font-medium underline-offset-4 hover:underline" href={api.ownedCreditNotePdfUrl(accountUuid, note.uuid)} download>
                          {note.number}
                        </a>
                        <span className="min-w-0 flex-1 break-words text-muted-foreground">{note.reason}</span>
                        <span className="tabular-nums">{money(-note.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {data.payments.length ? (
                <section aria-labelledby="invoice-payments-heading" className="flex flex-col gap-2">
                  <h3 id="invoice-payments-heading" className="text-heading">
                    Payments
                  </h3>
                  <ul className="divide-y">
                    {data.payments.map((payment) => (
                      <li key={payment.uuid} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                        <span className="min-w-0 flex-1 break-words">
                          {paymentLabels[payment.method]}
                          {payment.failure_reason ? (
                            <span className="block text-meta text-muted-foreground">{payment.failure_reason}</span>
                          ) : null}
                        </span>
                        <Status value={payment.status} domain="invoice_payment" />
                        <span className="tabular-nums">{money(payment.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {data.usage.length ? (
                <section aria-labelledby="invoice-usage-heading" className="flex flex-col gap-2">
                  <h3 id="invoice-usage-heading" className="text-heading">
                    Usage by organization
                  </h3>
                  <ul className="divide-y">
                    {data.usage.map((row) => (
                      <li key={`${row.organization_uuid}-${row.kind}`} className="flex items-baseline gap-4 py-2">
                        <span className="min-w-0 flex-1 break-words">
                          {row.organization_name} <span className="text-muted-foreground">· {usageKinds[row.kind]}</span>
                        </span>
                        <span className="tabular-nums">{row.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
