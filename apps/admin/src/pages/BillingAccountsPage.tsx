import { useEffect, useMemo, useState } from "react"
import { ApiError, type BillingAccountSummary, type DirectoryQuery, type PaginatedResponse } from "@iot-os/api-client"
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
import { DropdownMenuItem, DropdownMenuSeparator } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { PlusIcon, WalletIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { organizationsOfLimit } from "../components/BillingAccountChoice"
import { BillingAccountDialog } from "../components/BillingAccountDialog"
import { useDirectoryTable } from "../components/ResourceDirectory"
import { apiClient } from "../lib/api-client"

function loadBillingAccounts(query: DirectoryQuery): Promise<PaginatedResponse<BillingAccountSummary>> {
  return apiClient.adminBillingAccounts(query)
}

export const billingAccountPath = (uuid: string) => `/billing-accounts/${encodeURIComponent(uuid)}`

/** Billing accounts (spec 023): who pays for which organizations. */
export function BillingAccountsPage() {
  const navigate = useNavigate()
  const { reload, table } = useDirectoryTable(loadBillingAccounts, { searchPlaceholder: "Name or contact email" })
  const [editing, setEditing] = useState<BillingAccountSummary | "new" | null>(null)
  const [deleting, setDeleting] = useState<BillingAccountSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  // Open a new account once its dialog has closed; navigating in the same click would
  // meet the dialog's unsaved-changes guard while it still counts as dirty.
  useEffect(() => {
    if (created) navigate(billingAccountPath(created))
  }, [created, navigate])
  const columns = useMemo<DataColumn<BillingAccountSummary>[]>(
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
        id: "organizations",
        header: "Organizations",
        align: "end",
        value: (account) => account.organizations_count,
        cell: (account) => <span className="tabular-nums">{organizationsOfLimit(account)}</span>,
      },
      {
        id: "owners",
        header: "Owners",
        value: (account) => account.owners.map((owner) => owner.name).join(", "),
        cell: (account) =>
          account.owners.length ? (
            account.owners.map((owner) => owner.name).join(", ")
          ) : (
            <span className="text-muted-foreground">None</span>
          ),
      },
      {
        id: "contact",
        header: "Contact",
        value: (account) => account.contact_email ?? "",
        cell: (account) => account.contact_email ?? <span className="text-muted-foreground">—</span>,
      },
    ],
    [],
  )

  async function remove() {
    if (!deleting) return
    setBusy(true)

    try {
      await apiClient.deleteBillingAccount(deleting.uuid)
      toast.success(`${deleting.name} deleted`)
      setDeleting(null)
      reload()
    } catch (error) {
      const message = error instanceof ApiError ? (error.payload as { message?: string })?.message : undefined
      toast.error(message ?? "Could not delete this billing account. Try again.")
      setDeleting(null)
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollectionPage
      title="Billing accounts"
      description="Who pays for which organizations."
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          New billing account
        </Button>
      }
    >
      <DataTable
        id="admin-billing-accounts"
        label="Billing accounts"
        noun={["billing account", "billing accounts"]}
        rowKey={(account) => account.uuid}
        rowLabel={(account) => account.name}
        columns={columns}
        {...table}
        filters={[]}
        rowActions={(account) => (
          <>
            <DropdownMenuItem onSelect={() => navigate(billingAccountPath(account.uuid))}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing(account)}>Edit billing account</DropdownMenuItem>
            <DropdownMenuSeparator />
            {account.organizations_count > 0 ? (
              <DropdownMenuItem disabled>Delete: move its organizations first</DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(account)}>
                Delete billing account
              </DropdownMenuItem>
            )}
          </>
        )}
        empty={
          <EmptyState
            inset
            icon={<WalletIcon />}
            title="No billing accounts yet"
            description="Every organization gets one when it is created."
          />
        }
      />
      <BillingAccountDialog
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => (editing === "new" ? setCreated(saved.uuid) : reload())}
      />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It has no organizations. Its history is kept, but the account no longer appears anywhere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Delete billing account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CollectionPage>
  )
}
