import { useCallback, useEffect, useMemo, useState } from "react"
import { ApiError, type BillingPlanDetail, type PlanHistoryEntry } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { EntityPage } from "@iot-os/ui/templates/entity-page"
import { AlertCircleIcon, LayersIcon, WalletIcon } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { PlanDialog } from "../components/PlanDialog"
import { PlanPricesDialog } from "../components/PlanPricesDialog"
import { PriceList } from "../components/PriceList"
import { allowanceKinds, allowanceText, allowanceValue, changesText, historyFieldLabels } from "../lib/allowances"
import { apiClient } from "../lib/api-client"
import { billingAccountPath } from "./BillingAccountsPage"
import { usePlanActions } from "./PlansPage"

const back = { to: "/plans", label: "Plans" }

type PlanAccount = BillingPlanDetail["accounts"][number]

/** One plan history line in words, without the actor or the time. */
export function planHistoryText(entry: PlanHistoryEntry): string {
  switch (entry.action) {
    case "created":
      return entry.changes?.length
        ? `Created the plan with ${entry.changes.map((change) => `${historyFieldLabels[change.field] ?? change.field} ${change.to}`).join(", ")}`
        : "Created the plan"
    case "updated":
      return `Changed ${changesText(entry.changes)}`
    case "archived":
      return "Archived the plan"
    case "restored":
      return "Restored the plan"
  }
}

/** A plan's page (spec 028 US1, spec 029 US6): its allowances, prices, the accounts on it and its history. */
export function PlanPage() {
  const { planUuid = "" } = useParams()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<BillingPlanDetail | null>(null)
  const [failure, setFailure] = useState<"not_found" | "failed" | null>(null)
  const [editing, setEditing] = useState(false)
  const [pricing, setPricing] = useState(false)

  const load = useCallback(() => {
    setFailure(null)
    apiClient
      .adminPlan(planUuid)
      .then(setPlan)
      .catch((error) => setFailure(error instanceof ApiError && error.status === 404 ? "not_found" : "failed"))
  }, [planUuid])
  const actions = usePlanActions((saved) => (saved ? load() : navigate(back.to)))

  useEffect(() => {
    setPlan(null)
    load()
  }, [load])

  const accountColumns = useMemo<DataColumn<PlanAccount>[]>(
    () => [
      {
        id: "name",
        header: "Billing account",
        mobile: "title",
        value: (account) => account.name,
        cell: (account) => (
          <RefLink className="font-medium" to={billingAccountPath(account.uuid)}>
            {account.name}
          </RefLink>
        ),
      },
      {
        id: "kind",
        header: "How",
        mobile: "badge",
        hideable: false,
        value: (account) => account.kind,
        cell: (account) => <Status value={account.kind} domain="plan_assignment" />,
      },
      {
        id: "since",
        header: "Since",
        hideable: false,
        value: (account) => account.since,
        cell: (account) => <RelativeTime at={account.since} />,
      },
    ],
    [],
  )

  if (failure) {
    return (
      <>
        <PageHeader title="Plan" back={back} />
        <div className="p-4 md:p-6">
          {failure === "not_found" ? (
            <EmptyState
              icon={<LayersIcon />}
              title="Plan not found"
              description="It may have been deleted. Go back to Plans to find another."
            />
          ) : (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load this plan</AlertTitle>
              <AlertDescription>Go back to Plans and try again.</AlertDescription>
            </Alert>
          )}
        </div>
      </>
    )
  }

  if (!plan) {
    return (
      <>
        <PageHeader title="Plan" back={back} />
        <div className="flex flex-col gap-3 p-4 md:p-6" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </>
    )
  }

  const set = new Map(plan.allowances.map((allowance) => [allowance.kind, allowance.value]))

  return (
    <EntityPage
      title={plan.name}
      icon={<LayersIcon />}
      back={back}
      status={
        <>
          <Status value={plan.archived ? "archived" : "active"} />
          <span className="text-muted-foreground">
            {plan.accounts_count} billing {plan.accounts_count === 1 ? "account" : "accounts"}
          </span>
        </>
      }
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => void actions.archive(plan, !plan.archived)}>
            {plan.archived ? "Restore" : "Archive"}
          </Button>
          {plan.ever_assigned ? null : (
            <Button size="sm" variant="outline" onClick={() => actions.remove(plan)}>
              Delete
            </Button>
          )}
        </>
      }
    >
      <div className="grid min-w-0 gap-(--panel-gap) xl:grid-cols-2">
        <Panel aria-labelledby="plan-allowances">
          <PanelHeader>
            <PanelTitle id="plan-allowances">Allowances</PanelTitle>
            <PanelDescription>
              {plan.description ?? "Kinds the plan does not set use the deployment's default."}
            </PanelDescription>
          </PanelHeader>
          <PanelContent>
            <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
              {allowanceKinds.map((kind) => (
                <div key={kind} className="contents">
                  <dt className="text-muted-foreground">{allowanceText[kind].label}</dt>
                  <dd className="tabular-nums">
                    {set.has(kind) ? (
                      allowanceValue(kind, set.get(kind) ?? null)
                    ) : (
                      <span className="text-muted-foreground">Deployment default</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </PanelContent>
        </Panel>
        <Panel aria-labelledby="plan-prices">
          <PanelHeader>
            <PanelTitle id="plan-prices">Prices</PanelTitle>
            <PanelDescription>
              Charged on each account&apos;s monthly invoice, unless the account has an override. Changes apply from next
              month.
            </PanelDescription>
            <PanelActions>
              <Button size="sm" variant="outline" onClick={() => setPricing(true)}>
                Set prices
              </Button>
            </PanelActions>
          </PanelHeader>
          <PanelContent>
            <PriceList prices={plan.prices} />
          </PanelContent>
        </Panel>
      </div>
      <Panel aria-labelledby="plan-accounts">
        <PanelHeader>
          <PanelTitle id="plan-accounts">Billing accounts</PanelTitle>
          <PanelDescription>Accounts on this plan now, up to 100.</PanelDescription>
        </PanelHeader>
        <PanelContent flush>
          <DataTable
            id="admin-plan-accounts"
            label="Billing accounts on this plan"
            noun={["billing account", "billing accounts"]}
            rowKey={(account) => account.uuid}
            rowLabel={(account) => account.name}
            columns={accountColumns}
            rows={plan.accounts}
            empty={
              <EmptyState
                inset
                icon={<WalletIcon />}
                title="No billing accounts on this plan"
                description="Choose a plan on a billing account's page."
              />
            }
          />
        </PanelContent>
      </Panel>
      <Panel aria-labelledby="plan-history">
        <PanelHeader>
          <PanelTitle id="plan-history">History</PanelTitle>
          <PanelDescription>The latest 100 changes, newest first.</PanelDescription>
        </PanelHeader>
        <PanelContent>
          {plan.history.length ? (
            <ol className="divide-y">
              {plan.history.map((entry, index) => (
                <li key={`${entry.at}-${entry.action}-${index}`} className="flex flex-wrap items-baseline gap-x-2 py-2 first:pt-0">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{entry.actor?.name ?? "System"}</span> · {planHistoryText(entry)}
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
      <PlanDialog plan={editing ? plan : null} onClose={() => setEditing(false)} onSaved={setPlan} />
      <PlanPricesDialog plan={pricing ? plan : null} onClose={() => setPricing(false)} onSaved={setPlan} />
      {actions.dialog}
    </EntityPage>
  )
}
