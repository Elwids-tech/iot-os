import { useCallback, useEffect, useMemo, useState } from "react"
import type { DirectoryQuery, InvoiceSummary, WaitingInvoice } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Status } from "@iot-os/ui/components/status-mark"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iot-os/ui/components/tabs"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { formatMonth } from "@iot-os/ui/lib/invoices"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { ClockIcon, ReceiptTextIcon, TriangleAlertIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { DirectoryError } from "../components/DirectoryStates"
import { DraftInvoiceDialog, type DraftTarget } from "../components/DraftInvoiceDialog"
import { useInvoiceColumns } from "../components/InvoiceColumns"
import { useDirectory, useDirectoryParameters } from "../hooks/use-directory"
import { apiClient } from "../lib/api-client"
import { invoicePath } from "../lib/invoices"
import { billingAccountPath } from "./BillingAccountsPage"

type Tab = "drafts" | "waiting" | "issued" | "unpaid"

const tabs: { value: Tab; label: string }[] = [
  { value: "drafts", label: "Drafts" },
  { value: "waiting", label: "Waiting for usage" },
  { value: "issued", label: "Issued" },
  { value: "unpaid", label: "Unpaid" },
]

const loaders: Record<Exclude<Tab, "waiting">, (query: DirectoryQuery) => ReturnType<typeof apiClient.adminInvoices>> = {
  drafts: (query) => apiClient.adminInvoices({ ...query, status: "draft" }),
  issued: (query) => apiClient.adminInvoices({ ...query, status: "issued" }),
  unpaid: (query) => apiClient.adminInvoices({ ...query, unpaid: true }),
}

const empty: Record<Tab, { title: string; description: string }> = {
  drafts: { title: "No drafts to review", description: "Last month's invoices are drafted once its usage is final." },
  waiting: { title: "Nothing is waiting", description: "Every ended month has its usage in." },
  issued: { title: "No issued invoices yet", description: "Review a draft and issue it to number and send it." },
  unpaid: { title: "Nothing unpaid", description: "Every issued invoice is paid or credited." },
}

/** One tab's invoices, paged on the server. */
function InvoiceList({ tab }: { tab: Exclude<Tab, "waiting"> }) {
  const navigate = useNavigate()
  const url = useUrlState()
  const query = useDirectoryParameters()
  const { data, error } = useDirectory(loaders[tab], query)
  const columns = useInvoiceColumns()

  return (
    <DataTable
      id={`admin-invoices-${tab}`}
      label={tabs.find((item) => item.value === tab)?.label ?? "Invoices"}
      noun={["invoice", "invoices"]}
      rowKey={(invoice: InvoiceSummary) => invoice.uuid}
      rowLabel={(invoice) => invoice.number ?? `${invoice.billing_account.name} ${invoice.month}`}
      columns={columns}
      rows={data?.data}
      error={error ? <DirectoryError /> : undefined}
      pagination={{
        page: query.page ?? 1,
        pageSize: query.perPage ?? 25,
        total: data?.meta.total ?? 0,
        pageCount: data?.meta.last_page,
        onPageChange: (page: number) => url.set({ page: page > 1 ? String(page) : null }),
      }}
      rowActions={(invoice) => <DropdownMenuItem onSelect={() => navigate(invoicePath(invoice.uuid))}>Open</DropdownMenuItem>}
      empty={<EmptyState inset icon={<ReceiptTextIcon />} {...empty[tab]} />}
    />
  )
}

/** Accounts whose invoice for last month waits for final usage (FR-033). */
function WaitingList({ waiting, failed, onDraft }: { waiting: WaitingInvoice[] | null; failed: boolean; onDraft: (row: WaitingInvoice) => void }) {
  const columns = useMemo<DataColumn<WaitingInvoice>[]>(
    () => [
      {
        id: "account",
        header: "Billing account",
        mobile: "title",
        value: (row) => row.billing_account.name,
        cell: (row) => (
          <RefLink className="font-medium" to={billingAccountPath(row.billing_account.uuid)}>
            {row.billing_account.name}
          </RefLink>
        ),
      },
      {
        id: "month",
        header: "Month",
        hideable: false,
        value: (row) => row.month,
        cell: (row) => formatMonth(row.month),
      },
      {
        id: "since",
        header: "Waiting since",
        hideable: false,
        value: (row) => row.waiting_since,
        cell: (row) => <RelativeTime at={row.waiting_since} />,
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        hideable: false,
        value: (row) => (row.overdue ? "overdue" : "waiting"),
        cell: (row) => <Status value={row.overdue ? "overdue" : "waiting"} domain="invoice" />,
      },
    ],
    [],
  )

  return (
    <DataTable
      id="admin-invoices-waiting"
      label="Waiting for usage"
      noun={["account", "accounts"]}
      rowKey={(row) => `${row.billing_account.uuid}-${row.month}`}
      rowLabel={(row) => row.billing_account.name}
      columns={columns}
      rows={waiting ?? undefined}
      error={failed ? <DirectoryError /> : undefined}
      rowActions={(row) => <DropdownMenuItem onSelect={() => onDraft(row)}>Draft anyway</DropdownMenuItem>}
      empty={<EmptyState inset icon={<ClockIcon />} {...empty.waiting} />}
    />
  )
}

/**
 * Invoices (spec 029 US6): drafts to review and issue, accounts still waiting for final
 * usage, issued invoices, and those still to be paid.
 */
export function InvoicesPage() {
  const navigate = useNavigate()
  const url = useUrlState()
  const tab = (tabs.some((item) => item.value === url.get("tab")) ? url.get("tab") : "drafts") as Tab
  const [waiting, setWaiting] = useState<WaitingInvoice[] | null>(null)
  const [waitingFailed, setWaitingFailed] = useState(false)
  const [drafting, setDrafting] = useState<DraftTarget | null>(null)

  const loadWaiting = useCallback(() => {
    setWaitingFailed(false)
    apiClient
      .waitingInvoices()
      .then(setWaiting)
      .catch(() => setWaitingFailed(true))
  }, [])

  useEffect(loadWaiting, [loadWaiting])

  const overdue = (waiting ?? []).filter((row) => row.overdue).length

  return (
    <Tabs value={tab} onValueChange={(value) => url.set({ tab: value === "drafts" ? null : value, page: null })} className="flex-1 gap-0">
      <CollectionPage
        title="Invoices"
        description="Each month's invoices are drafted once its usage is final. Review them, adjust where agreed, then issue."
        tabs={
          <div className="-mx-1 w-full overflow-x-auto scrollbar-none">
            <TabsList variant="line" className="justify-start px-1" aria-label="Invoice views">
              {tabs.map((item) => (
                <TabsTrigger key={item.value} value={item.value} className="flex-none">
                  {item.label}
                  {item.value === "waiting" && waiting?.length ? ` (${waiting.length})` : ""}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        }
        notices={
          overdue > 0 && tab !== "waiting" ? (
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>
                {overdue === 1 ? "1 account has" : `${overdue} accounts have`} waited over 3 days for final usage
              </AlertTitle>
              <AlertDescription>
                Check the runtime is reporting, or draft their invoices anyway with a note.
                <Button variant="outline" size="sm" onClick={() => url.set({ tab: "waiting", page: null })}>
                  Show waiting accounts
                </Button>
              </AlertDescription>
            </Alert>
          ) : null
        }
      >
        <TabsContent value="drafts">
          <InvoiceList tab="drafts" />
        </TabsContent>
        <TabsContent value="waiting">
          <WaitingList
            waiting={waiting}
            failed={waitingFailed}
            onDraft={(row) => setDrafting({ account: row.billing_account, month: row.month.slice(0, 7) })}
          />
        </TabsContent>
        <TabsContent value="issued">
          <InvoiceList tab="issued" />
        </TabsContent>
        <TabsContent value="unpaid">
          <InvoiceList tab="unpaid" />
        </TabsContent>
      </CollectionPage>
      <DraftInvoiceDialog target={drafting} onClose={() => setDrafting(null)} onDrafted={(invoice) => navigate(invoicePath(invoice.uuid))} />
    </Tabs>
  )
}
