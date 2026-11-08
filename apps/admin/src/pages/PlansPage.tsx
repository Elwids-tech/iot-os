import { useCallback, useEffect, useMemo, useState } from "react"
import type { BillingPlan, DirectoryQuery } from "@iot-os/api-client"
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
import { DataTable, RefLink, type DataColumn, type DataFilter } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Status } from "@iot-os/ui/components/status-mark"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { LayersIcon, PlusIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { PlanDialog } from "../components/PlanDialog"
import { useDirectoryTable } from "../components/ResourceDirectory"
import { allowanceSummary } from "../lib/allowances"
import { apiClient } from "../lib/api-client"
import { errorMessage } from "../lib/errors"

export const planPath = (uuid: string) => `/plans/${encodeURIComponent(uuid)}`

/** The list shows current plans unless the filter asks for archived or all. */
type ArchivedFilter = "archived" | "all" | null

const archivedQuery = (filter: ArchivedFilter) => (filter === "archived" ? true : filter === "all" ? undefined : false)

/** Archive, restore and delete, shared by the list and the plan's page. */
export function usePlanActions(onChanged: (plan: BillingPlan | null) => void) {
  const [deleting, setDeleting] = useState<BillingPlan | null>(null)
  const [busy, setBusy] = useState(false)

  async function archive(plan: BillingPlan, archived: boolean) {
    try {
      const saved = archived ? await apiClient.archivePlan(plan.uuid) : await apiClient.restorePlan(plan.uuid)
      toast.success(archived ? `${plan.name} archived` : `${plan.name} restored`)
      onChanged(saved)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    try {
      await apiClient.deletePlan(deleting.uuid)
      toast.success(`${deleting.name} deleted`)
      setDeleting(null)
      onChanged(null)
    } catch (error) {
      toast.error(errorMessage(error))
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  const dialog = (
    <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
          <AlertDialogDescription>No billing account was ever on it. Its history goes with it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete plan"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { archive, remove: setDeleting, dialog }
}

/** Plans (spec 028 US1): the allowances billing accounts get from their pricing tier. */
export function PlansPage() {
  const navigate = useNavigate()
  const url = useUrlState()
  const archived = (url.get("archived") || null) as ArchivedFilter
  const load = useCallback(
    (query: DirectoryQuery) => apiClient.adminPlans({ ...query, archived: archivedQuery(archived) }),
    [archived],
  )
  const { reload, table } = useDirectoryTable(load, { searchPlaceholder: "Plan name" })
  const [editing, setEditing] = useState<BillingPlan | "new" | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const actions = usePlanActions(() => reload())

  // Open a new plan once its dialog has closed, so its unsaved-changes guard is clear.
  useEffect(() => {
    if (created) navigate(planPath(created))
  }, [created, navigate])

  const columns = useMemo<DataColumn<BillingPlan>[]>(
    () => [
      {
        id: "name",
        header: "Plan",
        mobile: "title",
        value: (plan) => plan.name,
        cell: (plan) => (
          <RefLink className="font-medium" to={planPath(plan.uuid)}>
            {plan.name}
          </RefLink>
        ),
      },
      {
        id: "allowances",
        header: "Allowances",
        value: (plan) => allowanceSummary(plan.allowances),
        cell: (plan) => <span className="text-muted-foreground">{allowanceSummary(plan.allowances)}</span>,
      },
      {
        id: "accounts",
        header: "Accounts",
        align: "end",
        value: (plan) => plan.accounts_count,
        cell: (plan) => <span className="tabular-nums">{plan.accounts_count.toLocaleString()}</span>,
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        value: (plan) => (plan.archived ? "archived" : "active"),
        cell: (plan) => <Status value={plan.archived ? "archived" : "active"} />,
      },
    ],
    [],
  )
  const filters = useMemo<DataFilter<BillingPlan>[]>(
    () => [
      {
        id: "archived",
        label: "Status",
        anyLabel: "Current plans",
        options: [
          { value: "archived", label: "Archived" },
          { value: "all", label: "All plans" },
        ],
        value: archived ? [archived] : [],
        onChange: (value) => url.set({ archived: value[0] ?? null, page: null }),
      },
    ],
    [archived, url],
  )

  return (
    <CollectionPage
      title="Plans"
      description="Named sets of allowances. Billing accounts on a plan get its allowances, unless they have an override."
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          New plan
        </Button>
      }
    >
      <DataTable
        id="admin-plans"
        label="Plans"
        noun={["plan", "plans"]}
        rowKey={(plan) => plan.uuid}
        rowLabel={(plan) => plan.name}
        columns={columns}
        {...table}
        filters={filters}
        filtered={table.filtered || archived !== null}
        onReset={() => url.clear(["search", "archived", "page"])}
        rowActions={(plan) => (
          <>
            <DropdownMenuItem onSelect={() => navigate(planPath(plan.uuid))}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing(plan)}>Edit plan</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.archive(plan, !plan.archived)}>
              {plan.archived ? "Restore plan" : "Archive plan"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {plan.ever_assigned ? (
              <DropdownMenuItem disabled>Delete: it was used, archive it instead</DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(plan)}>
                Delete plan
              </DropdownMenuItem>
            )}
          </>
        )}
        empty={
          <EmptyState
            inset
            icon={<LayersIcon />}
            title={archived === "archived" ? "No archived plans" : "No plans yet"}
            description="Without a plan, billing accounts get the deployment's default allowances."
          />
        }
      />
      <PlanDialog
        plan={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => (editing === "new" ? setCreated(saved.uuid) : reload())}
      />
      {actions.dialog}
    </CollectionPage>
  )
}
