import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { CreditNote, InvoiceSummary, OwnedBillingAccount, PriceKind } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { Tooltip, TooltipContent, TooltipTrigger } from "@iot-os/ui/components/tooltip"
import { UsagePanel } from "@iot-os/ui/components/usage-overview"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { formatDay, formatMonth, paymentState } from "@iot-os/ui/lib/invoices"
import { trialEndingSoon, trialText } from "@iot-os/ui/lib/trials"
import { formatMoney } from "@iot-os/ui/lib/money"
import { EntityPage } from "@iot-os/ui/templates/entity-page"
import { Building2Icon, CreditCardIcon, PlusIcon, ReceiptTextIcon, SparklesIcon, TriangleAlertIcon, WalletIcon } from "lucide-react"
import { toast } from "sonner"
import { LoadError } from "../components/forms"
import { api } from "../lib/api"
import { InvoiceDetail } from "./InvoiceDetail"
import { cardName, PaymentMethodPanel } from "./PaymentMethodPanel"
import { addCard, checkoutReturned, payable, payOnline } from "./payments"
import {
  allowanceLabels,
  allowanceValue,
  atLimit,
  billingAccountsKey,
  organizationsOfLimit,
  ownedInvoicesKey,
  priceLabels,
} from "./model"
import { NewOrganizationDialog } from "./NewOrganizationDialog"

type AccountOrganization = OwnedBillingAccount["organizations"][number]

/**
 * The account's trial (spec 029 FR-049): "Trial until {date}" or "Trial, no end date",
 * and "Add a card to keep your plan" when it ends within 7 days or ended without a card.
 */
function TrialBanner({ account, plan }: { account: OwnedBillingAccount; plan: NonNullable<OwnedBillingAccount["plan"]> }) {
  const [opening, setOpening] = useState(false)
  const ended = plan.kind === "trial_unpaid"
  const askForCard = account.payments_enabled && account.payment_method === null && (ended || trialEndingSoon(plan))
  const card = account.payment_method
  const next = askForCard
    ? "Add a card to keep your plan: it is charged from the day after."
    : card && !ended && plan.trial_ends_at
      ? `After the trial it stays on ${plan.name}, charged to ${cardName(card)}.`
      : null

  return (
    <Alert>
      {ended ? <TriangleAlertIcon /> : <SparklesIcon />}
      <AlertTitle>{ended ? `The trial of ${plan.name} has ended` : trialText(plan)}</AlertTitle>
      <AlertDescription>
        <p>
          {ended
            ? `The account stays on ${plan.name} and is not charged.`
            : `${plan.name}'s allowances and limits apply as usual, and no trial day is charged.`}{" "}
          {next}
        </p>
        {askForCard ? (
          <Button
            size="sm"
            className="mt-2"
            disabled={opening}
            onClick={async () => {
              setOpening(true)
              if (!(await addCard(account.uuid))) setOpening(false)
            }}
          >
            <CreditCardIcon data-icon="inline-start" />
            Add a card
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

const EXPLANATION =
  "A billing account groups organizations for billing. Owning it gives you no access to them: you open the ones you are a member of."

const priceKinds: PriceKind[] = ["base_price", "alert_overage_price", "data_point_overage_price"]

/** Back from Stripe, the page asks again until Stripe's event arrives, up to this many times. */
const CONFIRM_ATTEMPTS = 20

/**
 * The billing accounts the signed-in person owns (spec 023): the chosen one's plan,
 * allowances and prices, its usage by month with each organization's share (spec 028
 * US4, spec 029 US5), its card, issued invoices and credit notes, paid online on
 * Stripe's pages (spec 029 US6, US7), and the organizations it pays for. Back from
 * Stripe (`card=saved`, `paid=1`), it asks again until Stripe's event has arrived; a
 * payment's `session` has the API look the payment up at once.
 */
export default function BillingAccountsPage() {
  const state = useUrlState()
  const queryClient = useQueryClient()
  const savingCard = state.get("card") === "saved"
  const paying = state.get("paid") === "1" ? state.get("invoice") : ""
  const accounts = useQuery({
    queryKey: billingAccountsKey,
    queryFn: () => api.ownedBillingAccounts(),
    // Every two seconds while a saved card is confirmed, else every minute so usage stays current.
    refetchInterval: (query) => {
      const shown = query.state.data?.find((item) => item.uuid === state.get("account")) ?? query.state.data?.[0]
      return savingCard && shown && !shown.payment_method && query.state.dataUpdateCount < CONFIRM_ATTEMPTS ? 2000 : 60_000
    },
  })
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const account = accounts.data?.find((item) => item.uuid === state.get("account")) ?? accounts.data?.[0]
  const invoices = useQuery({
    queryKey: ownedInvoicesKey(account?.uuid ?? ""),
    queryFn: () => api.ownedInvoices(account?.uuid ?? ""),
    enabled: Boolean(account),
    refetchInterval: (query) => {
      const invoice = query.state.data?.invoices.find((item) => item.uuid === paying)
      return invoice && payable(invoice) && query.state.dataUpdateCount < CONFIRM_ATTEMPTS ? 2000 : false
    },
  })
  const openInvoice = state.get("invoice") || null
  const paid = invoices.data?.invoices.find((item) => item.uuid === paying && !payable(item))

  // Once Stripe's event has arrived, say so and forget the return marker. The router
  // drops the marker in a transition, and a refetch landing first runs the effect
  // again, so each toast has an id: sonner shows one per id.
  useEffect(() => {
    if (savingCard && account?.payment_method) {
      toast.success(`${cardName(account.payment_method)} saved`, { id: `card-saved-${account.uuid}` })
      state.set({ card: null })
    }
  }, [savingCard, account?.payment_method, state])
  // Stripe's return carries the session: have the API record the payment as Stripe has it.
  const session = paying ? state.get("session") : ""
  useEffect(() => {
    if (!session || !account) return
    state.set({ session: null })
    void checkoutReturned(account.uuid, paying, session).then(() =>
      queryClient.invalidateQueries({ queryKey: ownedInvoicesKey(account.uuid) }),
    )
  }, [session, paying, account, state, queryClient])
  useEffect(() => {
    if (paid) {
      toast.success(`Payment received for ${paid.number}`, { id: `paid-${paid.uuid}` })
      state.set({ paid: null })
      // The open invoice too, which was loaded before Stripe's event arrived.
      void queryClient.invalidateQueries({ queryKey: ownedInvoicesKey(paid.billing_account.uuid) })
    }
  }, [paid, state, queryClient])

  const columns = useMemo<DataColumn<AccountOrganization>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        mobile: "title",
        value: (organization) => organization.name,
        cell: (organization) => <span className="font-medium">{organization.name}</span>,
      },
      {
        id: "created",
        header: "Created",
        value: (organization) => organization.created_at ?? "",
        cell: (organization) => <RelativeTime at={organization.created_at} />,
      },
      {
        id: "access",
        header: "Access",
        align: "end",
        value: (organization) => (organization.member ? "Member" : "Not a member"),
        cell: (organization) =>
          organization.member ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/organizations/${encodeURIComponent(organization.uuid)}/home`}>
                Open<span className="sr-only"> {organization.name}</span>
              </Link>
            </Button>
          ) : (
            <span className="text-meta text-muted-foreground">Not a member</span>
          ),
      },
    ],
    [],
  )

  const invoiceColumns = useMemo<DataColumn<InvoiceSummary>[]>(
    () => [
      {
        id: "number",
        header: "Invoice",
        mobile: "title",
        value: (invoice) => invoice.number ?? "",
        cell: (invoice) => (
          <button
            type="button"
            className="font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={() => state.set({ invoice: invoice.uuid })}
          >
            {invoice.number}
          </button>
        ),
      },
      {
        id: "month",
        header: "Month",
        value: (invoice) => invoice.month,
        cell: (invoice) => formatMonth(invoice.month),
      },
      {
        id: "total",
        header: "Total",
        align: "end",
        value: (invoice) => invoice.total,
        cell: (invoice) => <span className="tabular-nums">{formatMoney(invoice.total, invoice.currency)}</span>,
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        value: (invoice) => paymentState(invoice) ?? "",
        cell: (invoice) => <Status value={paymentState(invoice)} domain="payment" />,
      },
      {
        id: "due",
        header: "Due",
        value: (invoice) => invoice.due_at ?? "",
        cell: (invoice) => (invoice.due_at ? formatDay(invoice.due_at) : "—"),
      },
      ...(account?.payments_enabled
        ? [
            {
              id: "pay",
              header: "Pay",
              align: "end" as const,
              hideable: false,
              value: (invoice: InvoiceSummary) => (payable(invoice) ? invoice.outstanding : 0),
              cell: (invoice: InvoiceSummary) =>
                payable(invoice) ? (
                  <Button size="sm" variant="outline" onClick={() => void payOnline(account.uuid, invoice)}>
                    Pay {formatMoney(invoice.outstanding, invoice.currency)}
                    <span className="sr-only"> for {invoice.number}</span>
                  </Button>
                ) : null,
            } satisfies DataColumn<InvoiceSummary>,
          ]
        : []),
    ],
    [state, account],
  )

  const creditColumns = useMemo<DataColumn<CreditNote>[]>(
    () => [
      {
        id: "number",
        header: "Credit note",
        mobile: "title",
        value: (note) => note.number,
        cell: (note) => <span className="font-medium">{note.number}</span>,
      },
      {
        id: "invoice",
        header: "For invoice",
        value: (note) => note.invoice.number,
        cell: (note) => note.invoice.number,
      },
      {
        id: "amount",
        header: "Amount",
        align: "end",
        value: (note) => note.amount,
        cell: (note) => <span className="tabular-nums">{formatMoney(note.amount, note.currency)}</span>,
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
        value: (note) => note.issued_at,
        cell: (note) => <RelativeTime at={note.issued_at} />,
      },
    ],
    [],
  )

  if (accounts.error)
    return (
      <EntityPage title="Billing accounts" icon={<WalletIcon />}>
        <LoadError error={accounts.error} what="your billing accounts" onRetry={() => accounts.refetch()} busy={accounts.isFetching} />
      </EntityPage>
    )

  if (accounts.data && !account)
    return (
      <EntityPage title="Billing accounts" icon={<WalletIcon />}>
        <EmptyState
          icon={<WalletIcon />}
          title="You don't own a billing account"
          description="The platform operator makes people owners of billing accounts."
        />
      </EntityPage>
    )

  if (!account)
    return (
      <EntityPage title="Billing accounts" icon={<WalletIcon />}>
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      </EntityPage>
    )

  const full = atLimit(account)
  const limitReason = `${account.name} allows ${account.organization_limit} ${account.organization_limit === 1 ? "organization" : "organizations"}. Contact the platform operator to raise the limit.`
  const newOrganization = (
    <Button size="sm" disabled={full} onClick={() => setCreating(true)}>
      <PlusIcon data-icon="inline-start" />
      New organization
    </Button>
  )
  const options = (accounts.data ?? [])
    .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
    .map((item) => ({ value: item.uuid, label: item.name }))

  return (
    <EntityPage
      title={account.name}
      icon={<WalletIcon />}
      status={<span className="text-muted-foreground">Billing account · {organizationsOfLimit(account)}</span>}
      actions={
        <>
          {full ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button gets no pointer or focus events, so the wrapper carries the tooltip. */}
                <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {newOrganization}
                </span>
              </TooltipTrigger>
              <TooltipContent>{limitReason}</TooltipContent>
            </Tooltip>
          ) : (
            newOrganization
          )}
        </>
      }
    >
      <p className="text-body text-muted-foreground">{EXPLANATION}</p>
      {account.past_due_since ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>An invoice is unpaid past its due date</AlertTitle>
          <AlertDescription>
            Nothing is restricted, and every device and dashboard keeps working.{" "}
            {account.payments_enabled ? "Pay it below, or replace the card if it was declined." : "Pay it as agreed with the platform operator."}
          </AlertDescription>
        </Alert>
      ) : null}
      {accounts.data && accounts.data.length > 1 ? (
        <SearchableSelect
          label="Billing account"
          className="max-w-sm"
          value={account.uuid}
          selectedLabel={account.name}
          options={options}
          search={search}
          onSearchChange={setSearch}
          emptyText="No billing accounts match."
          onChange={(uuid) => {
            setSearch("")
            state.set({ account: uuid, invoice: null })
          }}
        />
      ) : null}
      <Panel aria-labelledby="billing-plan">
        <PanelHeader>
          <PanelTitle id="billing-plan">Plan</PanelTitle>
          <PanelDescription>
            {account.plan ? (
              <>
                {account.plan.name} since <RelativeTime at={account.plan.since} />
              </>
            ) : (
              "No plan: the deployment's default allowances apply."
            )}
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          {account.plan && account.plan.kind !== "paid" ? <TrialBanner account={account} plan={account.plan} /> : null}
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {account.allowances.map((allowance) => (
              <div key={allowance.kind} className="flex min-w-0 flex-col">
                <dt className="text-meta text-muted-foreground">{allowanceLabels[allowance.kind]}</dt>
                <dd className="tabular-nums">{allowanceValue(allowance.kind, allowance.value, account.platform_retention_days)}</dd>
              </div>
            ))}
          </dl>
          {account.prices ? (
            <dl aria-label="Prices" className="grid gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-3">
              {priceKinds.map((kind) => {
                const prices = account.prices!
                const block = (size: number) => (kind === "data_point_overage_price" ? ` per ${size.toLocaleString()}` : "")
                const next = prices.next
                const changes =
                  next !== null &&
                  (next[kind] !== prices.current[kind] ||
                    (kind === "data_point_overage_price" && next.data_point_block_size !== prices.current.data_point_block_size))
                return (
                  <div key={kind} className="flex min-w-0 flex-col">
                    <dt className="text-meta text-muted-foreground">{priceLabels[kind]}</dt>
                    <dd className="tabular-nums">
                      {formatMoney(prices.current[kind], prices.currency)}
                      {block(prices.current.data_point_block_size)}
                      {next && changes ? (
                        <span className="block text-meta text-muted-foreground">
                          {formatMoney(next[kind], prices.currency)}
                          {block(next.data_point_block_size)} from {formatMonth(next.effective_from)}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                )
              })}
            </dl>
          ) : null}
        </PanelContent>
      </Panel>
      <PaymentMethodPanel account={account} saving={savingCard} />
      <UsagePanel
        key={account.uuid}
        id="billing-usage"
        description="Months are UTC. Alerts and data points over an allowance are overage and never stop. Owners are emailed once at 80% and once at 100% of each limited allowance a month."
        figures={account.usage}
        load={(month) => api.ownedBillingAccountUsage(account.uuid, month)}
        since={account.created_at}
      />
      <Panel aria-labelledby="billing-invoices">
        <PanelHeader>
          <PanelTitle id="billing-invoices">Invoices</PanelTitle>
          <PanelDescription>
            Each month&apos;s invoice is emailed to you when it is issued. Open one to see its lines, or download it to print.
          </PanelDescription>
        </PanelHeader>
        <PanelContent flush>
          <DataTable
            id="billing-account-invoices"
            label={`Invoices of ${account.name}`}
            noun={["invoice", "invoices"]}
            rows={invoices.data?.invoices}
            rowKey={(invoice) => invoice.uuid}
            rowLabel={(invoice) => invoice.number ?? invoice.month}
            columns={invoiceColumns}
            error={
              invoices.error ? (
                <LoadError error={invoices.error} what="the invoices" onRetry={() => invoices.refetch()} busy={invoices.isFetching} />
              ) : undefined
            }
            rowActions={(invoice) => (
              <>
                <DropdownMenuItem onSelect={() => state.set({ invoice: invoice.uuid })}>View</DropdownMenuItem>
                {account.payments_enabled && payable(invoice) ? (
                  <DropdownMenuItem onSelect={() => void payOnline(account.uuid, invoice)}>Pay online</DropdownMenuItem>
                ) : null}
                <DropdownMenuItem asChild>
                  <a href={api.ownedInvoiceDocumentUrl(account.uuid, invoice.uuid, "pdf")} download>
                    Download PDF
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={api.ownedInvoiceDocumentUrl(account.uuid, invoice.uuid, "csv")} download>
                    Download CSV
                  </a>
                </DropdownMenuItem>
              </>
            )}
            empty={
              <EmptyState
                inset
                icon={<ReceiptTextIcon />}
                title="No invoices yet"
                description="An invoice is issued after each month the account is on a plan."
              />
            }
          />
        </PanelContent>
      </Panel>
      {invoices.data?.credit_notes.length ? (
        <Panel aria-labelledby="billing-credit-notes">
          <PanelHeader>
            <PanelTitle id="billing-credit-notes">Credit notes</PanelTitle>
            <PanelDescription>Each reduces what an invoice owes; any rest comes off the next invoice.</PanelDescription>
          </PanelHeader>
          <PanelContent flush>
            <DataTable
              id="billing-account-credit-notes"
              label={`Credit notes of ${account.name}`}
              noun={["credit note", "credit notes"]}
              rows={invoices.data.credit_notes}
              rowKey={(note) => note.uuid}
              rowLabel={(note) => note.number}
              columns={creditColumns}
              rowActions={(note) => (
                <>
                  <DropdownMenuItem asChild>
                    <a href={api.ownedCreditNoteDocumentUrl(account.uuid, note.uuid, "pdf")} download>
                      Download PDF
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={api.ownedCreditNoteDocumentUrl(account.uuid, note.uuid, "csv")} download>
                      Download CSV
                    </a>
                  </DropdownMenuItem>
                </>
              )}
            />
          </PanelContent>
        </Panel>
      ) : null}
      <Panel aria-labelledby="billing-organizations">
        <PanelHeader>
          <PanelTitle id="billing-organizations">Organizations</PanelTitle>
        </PanelHeader>
        <PanelContent flush>
          <DataTable
            id="billing-account-organizations"
            label={`Organizations of ${account.name}`}
            noun={["organization", "organizations"]}
            rows={account.organizations}
            rowKey={(organization) => organization.uuid}
            rowLabel={(organization) => organization.name}
            columns={columns}
            defaultSort={[{ id: "name", desc: false }]}
            empty={
              <EmptyState
                inset
                icon={<Building2Icon />}
                title="No organizations yet"
                description="Organizations you create here belong to this billing account."
                action={full ? undefined : newOrganization}
              />
            }
          />
        </PanelContent>
      </Panel>
      {creating ? <NewOrganizationDialog account={account} onClose={() => setCreating(false)} /> : null}
      <InvoiceDetail
        accountUuid={account.uuid}
        invoiceUuid={openInvoice}
        paymentsEnabled={account.payments_enabled}
        onClose={() => state.set({ invoice: null, paid: null })}
      />
    </EntityPage>
  )
}
