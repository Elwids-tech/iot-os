import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ApiError,
  type Allowance,
  type BillingAccountDetail,
  type BillingAccountHistoryEntry,
  type BillingAccountOrganization,
  type BillingAccountOwner,
  type DirectoryQuery,
  type InvoiceSummary,
  type PriceKind,
  type PriceOverride,
  type RetentionNeedsConfirmation,
} from "@iot-os/api-client"
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
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { UsagePanel } from "@iot-os/ui/components/usage-overview"
import { formatDay, formatMonth } from "@iot-os/ui/lib/invoices"
import { trialLastDay } from "@iot-os/ui/lib/trials"
import { formatBasisPoints, formatMoney } from "@iot-os/ui/lib/money"
import { EntityPage } from "@iot-os/ui/templates/entity-page"
import { AlertCircleIcon, Building2Icon, ReceiptTextIcon, UserRoundXIcon, WalletIcon } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { AllowanceOverrideDialog } from "../components/AllowanceOverrideDialog"
import { atLimit, organizationsOfLimit } from "../components/BillingAccountChoice"
import { BillingAccountDialog } from "../components/BillingAccountDialog"
import { BillingDetailsDialog } from "../components/BillingDetailsDialog"
import { DraftInvoiceDialog, type DraftTarget } from "../components/DraftInvoiceDialog"
import { useInvoiceColumns } from "../components/InvoiceColumns"
import { PriceOverrideDialog } from "../components/PriceOverrideDialog"
import { ChangeBillingAccountDialog, type MovableOrganization } from "../components/ChangeBillingAccountDialog"
import { useSearchOptions } from "../hooks/use-search-options"
import { allowanceText, allowanceValue, changesText } from "../lib/allowances"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"
import { invoicePath, priceKinds, priceText } from "../lib/invoices"
import { planPath } from "./PlansPage"
import { RetentionConfirmDialog, retentionConfirmation } from "../components/RetentionConfirmDialog"
import { TrialDialog } from "../components/TrialDialog"

const back = { to: "/billing-accounts", label: "Billing accounts" }

function loadUsers(query: DirectoryQuery) {
  return apiClient.adminUsers(query)
}

/** Plans an account can move to: archived plans stay on their accounts but are not offered. */
function loadPlans(query: DirectoryQuery) {
  return apiClient.adminPlans({ ...query, archived: false })
}

/** One history line in words, without the actor or the time. */
export function historyText(entry: BillingAccountHistoryEntry): string {
  switch (entry.action) {
    case "created":
      return "Created the account"
    case "updated":
      return `Changed ${changesText(entry.changes)}`
    case "owner_added":
      return `Made ${entry.user?.name ?? "someone"} an owner`
    case "owner_removed":
      return `Removed ${entry.user?.name ?? "someone"} as an owner`
    case "organization_joined":
      return `${entry.organization?.name ?? "An organization"} joined`
    case "organization_left":
      return `${entry.organization?.name ?? "An organization"} left`
  }
}

/**
 * A billing account's page (spec 023 US2, spec 028 US2 and US4, spec 029 US5 and US6):
 * details, plan, allowances, prices, billing details, usage by month with each
 * organization's share, invoices, owners, organizations and history.
 */
export function BillingAccountPage() {
  const { billingAccountUuid = "" } = useParams()
  const navigate = useNavigate()
  const [account, setAccount] = useState<BillingAccountDetail | null>(null)
  const [failure, setFailure] = useState<"not_found" | "failed" | null>(null)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState<MovableOrganization | null>(null)
  const [removingOwner, setRemovingOwner] = useState<BillingAccountOwner | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [overriding, setOverriding] = useState<Allowance | null>(null)
  const [overridingPrice, setOverridingPrice] = useState<PriceOverride | null>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [drafting, setDrafting] = useState<DraftTarget | null>(null)
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null)
  const [invoicesFailed, setInvoicesFailed] = useState(false)
  const [removingPlan, setRemovingPlan] = useState(false)
  // The mode outlives the dialog, so its title holds while it closes.
  const [trialDialog, setTrialDialog] = useState<{ mode: "start" | "change"; open: boolean }>({ mode: "start", open: false })
  const [endingTrial, setEndingTrial] = useState<"end" | "convert" | null>(null)
  const [busy, setBusy] = useState(false)
  // A plan change or override removal that shortens retention, waiting for confirmation (spec 029 US4).
  const [retention, setRetention] = useState<{ confirmation: RetentionNeedsConfirmation; retry: () => Promise<void> } | null>(null)
  const users = useSearchOptions(loadUsers)
  const plans = useSearchOptions(loadPlans)

  const load = useCallback(() => {
    setFailure(null)
    apiClient
      .adminBillingAccount(billingAccountUuid)
      .then(setAccount)
      .catch((error) => setFailure(error instanceof ApiError && error.status === 404 ? "not_found" : "failed"))
  }, [billingAccountUuid])

  useEffect(() => {
    setAccount(null)
    load()
  }, [load])

  // The latest twelve invoices; the Invoices page lists every one.
  useEffect(() => {
    let active = true
    setInvoices(null)
    setInvoicesFailed(false)
    apiClient
      .adminInvoices({ account: billingAccountUuid, perPage: 12 })
      .then((page) => active && setInvoices(page.data))
      .catch(() => active && setInvoicesFailed(true))
    return () => {
      active = false
    }
  }, [billingAccountUuid])
  const invoiceColumns = useInvoiceColumns({ account: false })

  const organizationColumns = useMemo<DataColumn<BillingAccountOrganization>[]>(
    () => [
      {
        id: "name",
        header: "Organization",
        mobile: "title",
        value: (organization) => organization.name,
        cell: (organization) => <span className="font-medium">{organization.name}</span>,
      },
      {
        id: "slug",
        header: "Slug",
        hideable: false,
        value: (organization) => organization.slug,
        cell: (organization) => <span className="font-mono text-code text-muted-foreground">{organization.slug}</span>,
      },
      {
        id: "users",
        header: "Users",
        hideable: false,
        align: "end",
        value: (organization) => organization.users_count,
        cell: (organization) => <span className="tabular-nums">{organization.users_count.toLocaleString()}</span>,
      },
      {
        id: "devices",
        header: "Devices",
        hideable: false,
        align: "end",
        value: (organization) => organization.devices_count,
        cell: (organization) => <span className="tabular-nums">{organization.devices_count.toLocaleString()}</span>,
      },
      {
        id: "joined",
        header: "Joined",
        hideable: false,
        value: (organization) => organization.assigned_at ?? "",
        cell: (organization) => <RelativeTime at={organization.assigned_at} />,
      },
    ],
    [],
  )

  const allowanceColumns = useMemo<DataColumn<Allowance>[]>(
    () => [
      {
        id: "kind",
        header: "Allowance",
        mobile: "title",
        value: (allowance) => allowanceText[allowance.kind].label,
        cell: (allowance) => <span className="font-medium">{allowanceText[allowance.kind].label}</span>,
      },
      {
        id: "value",
        header: "Value",
        hideable: false,
        value: (allowance) => allowance.value ?? "",
        cell: (allowance) => <span className="tabular-nums">{allowanceValue(allowance.kind, allowance.value)}</span>,
      },
      {
        id: "source",
        header: "From",
        mobile: "badge",
        hideable: false,
        value: (allowance) => allowance.source,
        cell: (allowance) => <Status value={allowance.source} domain="allowance" />,
      },
      {
        id: "note",
        header: "Note",
        value: (allowance) => allowance.note ?? "",
        cell: (allowance) =>
          allowance.note ? (
            <span className="min-w-0 break-words">{allowance.note}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  )

  const prices = account?.prices
  const priceColumns = useMemo<DataColumn<PriceOverride>[]>(() => {
    if (!prices) return []
    const money = (amount: number) => formatMoney(amount, prices.currency)
    const block = (kind: PriceKind, size: number) => (kind === "data_point_overage_price" ? ` per ${size.toLocaleString()}` : "")
    return [
      {
        id: "price",
        header: "Price",
        mobile: "title",
        value: (row) => priceText[row.price].label,
        cell: (row) => <span className="font-medium">{priceText[row.price].label}</span>,
      },
      {
        id: "current",
        header: "This month",
        hideable: false,
        value: (row) => prices.current[row.price],
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">
              {money(prices.current[row.price])}
              {block(row.price, prices.current.data_point_block_size)}
            </span>
            {row.value !== null ? <Status value="override" domain="allowance" /> : null}
          </span>
        ),
      },
      {
        id: "next",
        header: prices.next ? `From ${formatDay(prices.next.effective_from)}` : "Next month",
        hideable: false,
        value: (row) => prices.next?.[row.price] ?? "",
        cell: (row) =>
          prices.next && prices.next[row.price] !== prices.current[row.price] ? (
            <span className="tabular-nums">
              {money(prices.next[row.price])}
              {block(row.price, prices.next.data_point_block_size)}
            </span>
          ) : (
            <span className="text-muted-foreground">No change</span>
          ),
      },
      {
        id: "note",
        header: "Override note",
        value: (row) => row.next_note ?? row.note ?? "",
        cell: (row) =>
          (row.next_note ?? row.note) ? (
            <span className="min-w-0 break-words">{row.next_note ?? row.note}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ]
  }, [prices])

  async function changePlan(planUuid: string | null, confirmRetention = false) {
    if (!account) return
    setBusy(true)
    try {
      const saved = await apiClient.setBillingAccountPlan(account.uuid, planUuid, confirmRetention)
      setRetention(null)
      toast.success(
        saved.plan_assignment
          ? `${account.name} is now on ${saved.plan_assignment.plan.name}`
          : `${account.name} is no longer on a plan`,
      )
      setAccount(saved)
      setRemovingPlan(false)
    } catch (error) {
      const shortens = retentionConfirmation(error)
      if (shortens) {
        setRemovingPlan(false)
        setRetention({ confirmation: shortens, retry: () => changePlan(planUuid, true) })
        return
      }
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /** Ends the trial now by the card rule, or turns it into the paid plan (spec 029 US8). */
  async function finishTrial(action: "end" | "convert") {
    if (!account) return
    setBusy(true)
    try {
      const saved = action === "end" ? await apiClient.endTrial(account.uuid) : await apiClient.convertTrial(account.uuid)
      toast.success(
        saved.plan_assignment?.kind === "paid"
          ? `${account.name} is on ${saved.plan_assignment.plan.name}, charged from tomorrow`
          : `The trial ended. ${account.name} is not charged until an owner saves a card`,
      )
      setAccount(saved)
      setEndingTrial(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /** A trial plan that shortens retention waits for the confirmation; `apply` sends it again. */
  function confirmTrialRetention(confirmation: RetentionNeedsConfirmation, apply: () => Promise<void>) {
    setRetention({
      confirmation,
      retry: async () => {
        setBusy(true)
        try {
          await apply()
          setRetention(null)
        } catch (error) {
          toast.error(errorMessage(error))
        } finally {
          setBusy(false)
        }
      },
    })
  }

  async function removePriceOverride(price: PriceKind) {
    if (!account) return
    try {
      const saved = await apiClient.overridePrice(account.uuid, price, { value: null, note: null })
      toast.success(`${priceText[price].label} for ${account.name} goes back to the plan's from ${formatDay(saved.effective_from)}`)
      setAccount(saved.account)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function removeOverride(allowance: Allowance, confirmRetention = false) {
    if (!account) return
    try {
      const saved = await apiClient.removeAllowanceOverride(account.uuid, allowance.kind, confirmRetention)
      setRetention(null)
      const now = saved.allowances.find((item) => item.kind === allowance.kind)
      toast.success(
        `${allowanceText[allowance.kind].label} for ${account.name} is back to ${allowanceValue(allowance.kind, now?.value ?? null)}`,
      )
      setAccount(saved)
    } catch (error) {
      const shortens = retentionConfirmation(error)
      if (shortens) {
        setRetention({ confirmation: shortens, retry: () => removeOverride(allowance, true) })
        return
      }
      toast.error(errorMessage(error))
    }
  }

  async function addOwner(userId: string) {
    if (!account) return
    try {
      const owners = await apiClient.addBillingAccountOwner(account.uuid, Number(userId))
      const added = owners.find((owner) => owner.id === Number(userId))
      toast.success(`${added?.name ?? "The owner"} can now see ${account.name}`)
      load()
    } catch {
      toast.error("Could not add this owner. Try again.")
    }
  }

  async function removeOwner() {
    if (!account || !removingOwner) return
    setBusy(true)
    try {
      await apiClient.removeBillingAccountOwner(account.uuid, removingOwner.id)
      toast.success(`${removingOwner.name} is no longer an owner`)
      setRemovingOwner(null)
      load()
    } catch {
      toast.error("Could not remove this owner. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!account) return
    setBusy(true)
    try {
      await apiClient.deleteBillingAccount(account.uuid)
      toast.success(`${account.name} deleted`)
      navigate(back.to)
    } catch (error) {
      const message = error instanceof ApiError ? (error.payload as { message?: string })?.message : undefined
      toast.error(message ?? "Could not delete this billing account. Try again.")
      setDeleting(false)
      load()
    } finally {
      setBusy(false)
    }
  }

  if (failure) {
    return (
      <>
        <PageHeader title="Billing account" back={back} />
        <div className="p-4 md:p-6">
          {failure === "not_found" ? (
            <EmptyState
              icon={<WalletIcon />}
              title="Billing account not found"
              description="It may have been deleted. Go back to Billing accounts to find another."
            />
          ) : (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load this billing account</AlertTitle>
              <AlertDescription>Go back to Billing accounts and try again.</AlertDescription>
            </Alert>
          )}
        </div>
      </>
    )
  }

  if (!account) {
    return (
      <>
        <PageHeader title="Billing account" back={back} />
        <div className="flex flex-col gap-3 p-4 md:p-6" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </>
    )
  }

  const ownerIds = new Set(account.owners.map((owner) => owner.id))
  const priceRows = priceKinds.map(
    (price) =>
      account.price_overrides.find((row) => row.price === price) ?? { price, value: null, note: null, next_value: null, next_note: null },
  )
  const details = account.billing_details
  const assignment = account.plan_assignment

  return (
    <EntityPage
      title={account.name}
      icon={<WalletIcon />}
      back={back}
      status={
        <>
          {account.past_due_since ? (
            <span className="flex items-center gap-2">
              <Status value="past_due" domain="payment" />
              <span className="text-muted-foreground">
                since <RelativeTime at={account.past_due_since} />
              </span>
            </span>
          ) : null}
          <span className="text-muted-foreground">
            {organizationsOfLimit(account)}
            {atLimit(account) ? " · owners cannot add more" : ""}
          </span>
        </>
      }
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </>
      }
    >
      <div className="grid min-w-0 gap-(--panel-gap) xl:grid-cols-2">
        <Panel aria-labelledby="billing-details">
          <PanelHeader>
            <PanelTitle id="billing-details">Details</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="min-w-0 break-words">{account.contact_email ?? "None"}</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>
                <RelativeTime at={account.created_at} />
              </dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words">{account.notes ?? "None"}</dd>
            </dl>
          </PanelContent>
        </Panel>
        <Panel aria-labelledby="billing-owners">
          <PanelHeader>
            <PanelTitle id="billing-owners">Owners</PanelTitle>
            <PanelDescription>Owners see this account and create organizations under it, up to the limit.</PanelDescription>
          </PanelHeader>
          <PanelContent className="flex flex-col gap-3">
            {account.owners.length ? (
              <ul className="divide-y">
                {account.owners.map((owner) => (
                  <li key={owner.id} className="flex items-center gap-3 py-2 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{owner.name}</p>
                      <p className="truncate text-meta text-muted-foreground">
                        {owner.email} · added <RelativeTime at={owner.added_at} />
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${owner.name} as an owner`}
                      onClick={() => setRemovingOwner(owner)}
                    >
                      <UserRoundXIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No owners. Only platform administrators can add organizations.</p>
            )}
            <SearchableSelect
              label="Add an owner"
              value=""
              placeholder="Choose a user"
              emptyText={users.failed ? "Users could not be loaded." : "No users match."}
              {...users.select}
              options={users.items
                .filter((user) => !ownerIds.has(user.id))
                .map((user) => ({ value: String(user.id), label: `${user.name} · ${user.email}` }))}
              onChange={(userId) => void addOwner(userId)}
            />
          </PanelContent>
        </Panel>
      </div>
      <div className="grid min-w-0 gap-(--panel-gap) xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel aria-labelledby="billing-plan">
          <PanelHeader>
            <PanelTitle id="billing-plan">Plan</PanelTitle>
            <PanelDescription>The account gets its plan&apos;s allowances, except where it has an override.</PanelDescription>
          </PanelHeader>
          <PanelContent className="flex flex-col gap-3">
            {assignment ? (
              <div className="flex flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2">
                  <RefLink className="font-medium" to={planPath(assignment.plan.uuid)}>
                    {assignment.plan.name}
                  </RefLink>
                  <Status value={assignment.kind} domain="plan_assignment" />
                  {assignment.plan.archived ? <Status value="archived" /> : null}
                </p>
                <p className="text-meta text-muted-foreground">
                  Since <RelativeTime at={assignment.started_at} />
                  {assignment.kind === "trial"
                    ? assignment.trial_ends_at
                      ? ` · until ${formatDay(trialLastDay(assignment.trial_ends_at))}`
                      : " · no end date"
                    : null}
                </p>
                {assignment.kind === "trial_unpaid" ? (
                  <p className="text-meta text-muted-foreground">
                    Not charged until an owner saves a card or the trial is converted to paid.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground">No plan. The account gets the deployment&apos;s default allowances.</p>
            )}
            <SearchableSelect
              label={assignment ? "Change plan" : "Choose a plan"}
              value=""
              placeholder="Choose a plan"
              help={assignment && assignment.kind !== "paid" ? "A paid plan, which ends the trial." : undefined}
              emptyText={plans.failed ? "Plans could not be loaded." : "No plans match."}
              disabled={busy}
              {...plans.select}
              options={plans.items
                .filter((plan) => plan.uuid !== assignment?.plan.uuid)
                .map((plan) => ({ value: plan.uuid, label: plan.name }))}
              onChange={(planUuid) => void changePlan(planUuid)}
            />
            <div className="flex flex-wrap gap-2">
              {assignment?.kind === "trial" ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setTrialDialog({ mode: "change", open: true })}>
                    Change trial
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setEndingTrial("end")}>
                    End trial
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setTrialDialog({ mode: "start", open: true })}>
                  Start trial
                </Button>
              )}
              {assignment && assignment.kind !== "paid" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setEndingTrial("convert")}>
                  Convert to paid
                </Button>
              ) : null}
              {assignment ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemovingPlan(true)}>
                  Remove plan
                </Button>
              ) : null}
            </div>
          </PanelContent>
        </Panel>
        <Panel aria-labelledby="billing-allowances">
          <PanelHeader>
            <PanelTitle id="billing-allowances">Allowances</PanelTitle>
            <PanelDescription>Each is an override, else the plan&apos;s, else the deployment&apos;s default.</PanelDescription>
          </PanelHeader>
          <PanelContent flush>
            <DataTable
              id="admin-billing-account-allowances"
              label="Allowances"
              noun={["allowance", "allowances"]}
              rowKey={(allowance) => allowance.kind}
              rowLabel={(allowance) => allowanceText[allowance.kind].label}
              columns={allowanceColumns}
              rows={account.allowances}
              rowActions={(allowance) => (
                <>
                  <DropdownMenuItem onSelect={() => setOverriding(allowance)}>
                    {allowance.source === "override" ? "Change override" : "Override"}
                  </DropdownMenuItem>
                  {allowance.source === "override" ? (
                    <DropdownMenuItem onSelect={() => void removeOverride(allowance)}>Remove override</DropdownMenuItem>
                  ) : null}
                </>
              )}
            />
          </PanelContent>
        </Panel>
      </div>
      <div className="grid min-w-0 gap-(--panel-gap) xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel aria-labelledby="billing-prices">
          <PanelHeader>
            <PanelTitle id="billing-prices">Prices</PanelTitle>
            <PanelDescription>The plan&apos;s prices, except where this account has an override. Changes apply from next month.</PanelDescription>
          </PanelHeader>
          {account.prices ? (
            <PanelContent flush>
              <DataTable
                id="admin-billing-account-prices"
                label="Prices"
                noun={["price", "prices"]}
                rowKey={(row) => row.price}
                rowLabel={(row) => priceText[row.price].label}
                columns={priceColumns}
                rows={priceRows}
                rowActions={(row) => (
                  <>
                    <DropdownMenuItem onSelect={() => setOverridingPrice(row)}>
                      {row.value !== null || row.next_value !== null ? "Change override" : "Override"}
                    </DropdownMenuItem>
                    {row.next_value !== null ? (
                      <DropdownMenuItem onSelect={() => void removePriceOverride(row.price)}>Remove override</DropdownMenuItem>
                    ) : null}
                  </>
                )}
              />
            </PanelContent>
          ) : (
            <PanelContent>
              <p className="text-muted-foreground">No plan, so nothing is charged. Choose a plan to see its prices here.</p>
            </PanelContent>
          )}
        </Panel>
        <div className="flex min-w-0 flex-col gap-(--panel-gap)">
          <Panel aria-labelledby="billing-invoice-details">
            <PanelHeader>
              <PanelTitle id="billing-invoice-details">Billing details</PanelTitle>
              <PanelDescription>What its invoices say about it.</PanelDescription>
              <PanelActions>
                <Button size="sm" variant="outline" onClick={() => setEditingDetails(true)}>
                  Edit billing details
                </Button>
              </PanelActions>
            </PanelHeader>
            <PanelContent>
              <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Address</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words">{details.billing_address ?? "None"}</dd>
                <dt className="text-muted-foreground">Tax number</dt>
                <dd className="min-w-0 break-words">{details.tax_number ?? "None"}</dd>
                <dt className="text-muted-foreground">Tax rate</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-x-2">
                  {details.tax_rate ? (
                    <>
                      {details.tax_rate.name} · {formatBasisPoints(details.tax_rate.basis_points)}
                      {details.tax_rate.archived ? <Status value="archived" /> : null}
                    </>
                  ) : (
                    "No tax"
                  )}
                </dd>
              </dl>
            </PanelContent>
          </Panel>
          <Panel aria-labelledby="billing-payment-method">
            <PanelHeader>
              <PanelTitle id="billing-payment-method">Payment method</PanelTitle>
              <PanelDescription>Owners save and change it on Stripe&apos;s page in the portal.</PanelDescription>
            </PanelHeader>
            <PanelContent>
              {account.payment_method ? (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">
                    {account.payment_method.brand.charAt(0).toUpperCase() + account.payment_method.brand.slice(1)}
                  </span>
                  {account.payment_method.last_four ? <span className="tabular-nums">•••• {account.payment_method.last_four}</span> : null}
                  {account.payment_method.expires ? (
                    <span className="text-meta text-muted-foreground">expires {formatMonth(account.payment_method.expires)}</span>
                  ) : null}
                </p>
              ) : (
                <p className="text-muted-foreground">No card. Invoices are paid online or recorded by hand.</p>
              )}
            </PanelContent>
          </Panel>
        </div>
      </div>
      <UsagePanel
        id="billing-usage"
        description="Months are UTC. Alerts, SMS and data points over an allowance are overage; devices are a level."
        figures={account.usage}
        load={(month) => apiClient.adminBillingAccountUsage(account.uuid, month)}
        since={account.created_at}
      />
      <Panel aria-labelledby="billing-invoices">
        <PanelHeader>
          <PanelTitle id="billing-invoices">Invoices</PanelTitle>
          <PanelDescription>The latest twelve. Drafts are made after each month once its usage is final.</PanelDescription>
          <PanelActions>
            <Button size="sm" variant="outline" onClick={() => setDrafting({ account: { uuid: account.uuid, name: account.name } })}>
              Draft invoice
            </Button>
          </PanelActions>
        </PanelHeader>
        <PanelContent flush>
          <DataTable
            id="admin-billing-account-invoices"
            label="Invoices"
            noun={["invoice", "invoices"]}
            rowKey={(invoice) => invoice.uuid}
            rowLabel={(invoice) => invoice.number ?? invoice.month}
            columns={invoiceColumns}
            rows={invoices ?? undefined}
            error={
              invoicesFailed ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Could not load the invoices. Reload the page.</AlertDescription>
                </Alert>
              ) : undefined
            }
            rowActions={(invoice) => (
              <DropdownMenuItem onSelect={() => navigate(invoicePath(invoice.uuid))}>Open</DropdownMenuItem>
            )}
            empty={
              <EmptyState
                inset
                icon={<ReceiptTextIcon />}
                title="No invoices yet"
                description="An invoice is drafted after each month the account is on a plan."
              />
            }
          />
        </PanelContent>
      </Panel>
      <Panel aria-labelledby="billing-organizations">
        <PanelHeader>
          <PanelTitle id="billing-organizations">Organizations</PanelTitle>
        </PanelHeader>
        <PanelContent flush>
          <DataTable
            id="admin-billing-account-organizations"
            label="Organizations"
            noun={["organization", "organizations"]}
            rowKey={(organization) => organization.uuid}
            rowLabel={(organization) => organization.name}
            columns={organizationColumns}
            rows={account.organizations}
            rowActions={(organization) => (
              <DropdownMenuItem
                onSelect={() =>
                  setMoving({ ...organization, billing_account: { uuid: account.uuid, name: account.name } })
                }
              >
                Change billing account
              </DropdownMenuItem>
            )}
            empty={
              <EmptyState
                inset
                icon={<Building2Icon />}
                title="No organizations"
                description="Move organizations here from Organizations, or delete this account."
              />
            }
          />
        </PanelContent>
      </Panel>
      <Panel aria-labelledby="billing-history">
        <PanelHeader>
          <PanelTitle id="billing-history">History</PanelTitle>
          <PanelDescription>The latest 100 changes, newest first.</PanelDescription>
        </PanelHeader>
        <PanelContent>
          {account.history.length ? (
            <ol className="divide-y">
              {account.history.map((entry, index) => (
                <li key={`${entry.at}-${entry.action}-${index}`} className="flex flex-wrap items-baseline gap-x-2 py-2 first:pt-0">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{entry.actor?.name ?? "System"}</span> · {historyText(entry)}
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
      <BillingAccountDialog account={editing ? account : null} onClose={() => setEditing(false)} onSaved={setAccount} />
      <ChangeBillingAccountDialog organization={moving} onClose={() => setMoving(null)} onMoved={load} />
      <AllowanceOverrideDialog
        account={account}
        allowance={overriding}
        onClose={() => setOverriding(null)}
        onSaved={setAccount}
      />
      {account.prices ? (
        <PriceOverrideDialog
          account={account}
          currency={account.prices.currency}
          price={overridingPrice}
          onClose={() => setOverridingPrice(null)}
          onSaved={setAccount}
        />
      ) : null}
      <BillingDetailsDialog account={editingDetails ? account : null} onClose={() => setEditingDetails(false)} onSaved={setAccount} />
      <DraftInvoiceDialog target={drafting} onClose={() => setDrafting(null)} onDrafted={(invoice) => navigate(invoicePath(invoice.uuid))} />
      <AlertDialog open={removingPlan} onOpenChange={(open) => !open && !busy && setRemovingPlan(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take {account.name} off {assignment?.plan.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              From now on it gets the deployment&apos;s default allowances, except where it has an override. Its
              plan history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void changePlan(null)}>
              {busy ? "Removing…" : "Remove plan"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={endingTrial !== null} onOpenChange={(open) => !open && !busy && setEndingTrial(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {endingTrial === "end" ? `End the trial of ${assignment?.plan.name} now?` : `Convert ${account.name} to paid?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {endingTrial === "convert"
                ? `It stays on ${assignment?.plan.name} and is charged from tomorrow, with or without a saved card.`
                : account.payment_method
                  ? `It stays on ${assignment?.plan.name} and is charged to the saved card from tomorrow. Owners are emailed.`
                  : `There is no saved card, so it stays on ${assignment?.plan.name}, not charged, and is flagged "trial ended, no payment method" until an owner saves one. Owners are emailed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => endingTrial && void finishTrial(endingTrial)}>
              {endingTrial === "end" ? (busy ? "Ending…" : "End trial") : busy ? "Converting…" : "Convert to paid"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TrialDialog
        account={account}
        mode={trialDialog.mode}
        open={trialDialog.open}
        onClose={() => setTrialDialog((current) => ({ ...current, open: false }))}
        onSaved={setAccount}
        onRetention={confirmTrialRetention}
      />
      <AlertDialog open={removingOwner !== null} onOpenChange={(open) => !open && !busy && setRemovingOwner(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removingOwner?.name} as an owner?</AlertDialogTitle>
            <AlertDialogDescription>
              They stop seeing {account.name} and cannot create organizations under it. Their memberships in its
              organizations stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void removeOwner()}>
              {busy ? "Removing…" : "Remove owner"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleting} onOpenChange={(open) => !open && !busy && setDeleting(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {account.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {account.organizations_count > 0
                ? `Move its ${account.organizations_count === 1 ? "organization" : `${account.organizations_count} organizations`} to another billing account first.`
                : "It has no organizations. Its history is kept, but the account no longer appears anywhere."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{account.organizations_count > 0 ? "Close" : "Cancel"}</AlertDialogCancel>
            {account.organizations_count === 0 ? (
              <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
                {busy ? "Deleting…" : "Delete billing account"}
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RetentionConfirmDialog
        confirmation={retention?.confirmation ?? null}
        busy={busy}
        onCancel={() => setRetention(null)}
        onConfirm={() => retention && void retention.retry()}
      />
    </EntityPage>
  )
}
