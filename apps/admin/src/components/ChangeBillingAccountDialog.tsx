import { useEffect, useState } from "react"
import type { BillingAccountSummary, DirectoryQuery } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useSearchOptions } from "../hooks/use-search-options"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"
import { organizationsOfLimit } from "./BillingAccountChoice"

export type MovableOrganization = { uuid: string; name: string; billing_account?: { uuid: string; name: string } }

function loadAccounts(query: DirectoryQuery) {
  return apiClient.adminBillingAccounts(query)
}

/**
 * Moves an organization to another billing account (spec 023 FR-012). Nothing inside
 * the organization changes, and the account's limit does not apply.
 */
export function ChangeBillingAccountDialog({
  organization,
  onClose,
  onMoved,
}: {
  organization: MovableOrganization | null
  onClose: () => void
  onMoved: () => void
}) {
  const accounts = useSearchOptions(loadAccounts, organization !== null)
  const [target, setTarget] = useState<BillingAccountSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTarget(null)
    setError(null)
  }, [organization])

  async function move() {
    if (!organization || !target) return
    setBusy(true)
    setError(null)

    try {
      await apiClient.moveOrganizationBillingAccount(organization.uuid, target.uuid)
      toast.success(`${organization.name} moved to ${target.name}`)
      onMoved()
      onClose()
    } catch (reason) {
      setError(fieldMessages(validationErrors(reason), "billing_account_uuid")?.join(" ") ?? "Could not move this organization. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const current = organization?.billing_account?.uuid

  return (
    <Dialog open={organization !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Change billing account</DialogTitle>
          <DialogDescription>
            {organization?.name} belongs to {organization?.billing_account?.name ?? "its billing account"}. Moving it
            changes who pays from now on; its members, devices and data stay as they are.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <SearchableSelect
            label="New billing account"
            value={target?.uuid ?? ""}
            selectedLabel={target?.name}
            placeholder="Choose a billing account"
            emptyText={accounts.failed ? "Billing accounts could not be loaded." : "No other billing accounts match."}
            disabled={busy}
            {...accounts.select}
            options={accounts.items
              .filter((account) => account.uuid !== current)
              .map((account) => ({ value: account.uuid, label: `${account.name} · ${organizationsOfLimit(account)}` }))}
            onChange={(uuid) => setTarget(accounts.items.find((account) => account.uuid === uuid) ?? null)}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void move()} disabled={busy || !target}>
            {busy ? "Moving…" : "Move organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
