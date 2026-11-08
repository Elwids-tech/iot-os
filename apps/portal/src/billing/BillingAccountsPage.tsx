import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import type { CreditNote, InvoiceSummary, OwnedBillingAccount, PriceKind } from "@iot-os/api-client"
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
import { formatMoney } from "@iot-os/ui/lib/money"
import { EntityPage } from "@iot-os/ui/templates/entity-page"
import { Building2Icon, PlusIcon, ReceiptTextIcon, WalletIcon } from "lucide-react"
import { LoadError } from "../components/forms"
import { api } from "../lib/api"
import { InvoiceDetail } from "./InvoiceDetail"
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

const EXPLANATION =
  "A billing account groups organizations for billing. Owning it gives you no access to them: you open the ones you are a member of."

const priceKinds: PriceKind[] = ["base_price", "alert_overage_price", "data_point_overage_price"]

/**
 * The billing accounts the signed-in person owns (spec 023): the chosen one's plan,
 * allowances and prices, its usage by month with each organization's share (spec 028
 * US4, spec 029 US5), its issued invoices and credit notes (spec 029 US6), and the
 * organizations it pays for.
 */
export default function BillingAccountsPage() {
  const state = useUrlState()
  const accounts = useQuery({ queryKey: billingAccountsKey, queryFn: () => api.ownedBillingAccounts() })
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const account = accounts.data?.find((item) => item.uuid === state.get("account")) ?? accounts.data?.[0]
  const invoices = useQuery({
    queryKey: ownedInvoicesKey(account?.uuid ?? ""),
    queryFn: () => api.ownedInvoices(account?.uuid ?? ""),
    enabled: Boolean(account),
  })
  const openInvoice = state.get("invoice") || null

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
    ],
    [state],
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
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {account.allowances.map((allowance) => (
              <div key={allowance.kind} className="flex min-w-0 flex-col">
                <dt className="text-meta text-muted-foreground">{allowanceLabels[allowance.kind]}</dt>
                <dd className="tabular-nums">{allowanceValue(allowance.kind, allowance.value)}</dd>
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
      <UsagePanel
        key={account.uuid}
        id="billing-usage"
        description="Months are UTC. Alerts and data points over an allowance are overage and never stop."
        figures={account.usage}
        load={(month) => api.ownedBillingAccountUsage(account.uuid, month)}
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
                <DropdownMenuItem asChild>
                  <a href={api.ownedCreditNotePdfUrl(account.uuid, note.uuid)} download>
                    Download PDF
                  </a>
                </DropdownMenuItem>
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
      <InvoiceDetail accountUuid={account.uuid} invoiceUuid={openInvoice} onClose={() => state.set({ invoice: null })} />
    </EntityPage>
  )
}
