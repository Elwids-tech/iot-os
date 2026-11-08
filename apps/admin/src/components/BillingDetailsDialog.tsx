import { FormEvent, useEffect, useState } from "react"
import type { BillingAccountDetail, TaxRate } from "@iot-os/api-client"
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
import { TextareaField, TextField } from "@iot-os/ui/components/form-fields"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { formatBasisPoints } from "@iot-os/ui/lib/money"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"

const NO_TAX = "none"

const rateLabel = (rate: TaxRate) => `${rate.name} · ${formatBasisPoints(rate.basis_points)}${rate.archived ? " · archived" : ""}`

/**
 * What a billing account's invoices say about it (spec 029 FR-029): its billing address,
 * an optional tax number and its tax rate, or none. Drafts pick changes up when they
 * are recalculated; issued invoices keep what they were issued with.
 */
export function BillingDetailsDialog({
  account,
  onClose,
  onSaved,
}: {
  account: BillingAccountDetail | null
  onClose: () => void
  onSaved: (account: BillingAccountDetail) => void
}) {
  const details = account?.billing_details
  const baseline = {
    address: details?.billing_address ?? "",
    taxNumber: details?.tax_number ?? "",
    rate: details?.tax_rate?.uuid ?? NO_TAX,
  }
  const [values, setValues] = useState(baseline)
  const [rates, setRates] = useState<TaxRate[] | null>(null)
  const [search, setSearch] = useState("")
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty =
    account !== null &&
    (values.address !== baseline.address || values.taxNumber !== baseline.taxNumber || values.rate !== baseline.rate)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard these billing details?",
    description: "The account keeps its billing details.",
  })

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(false)
    setSearch("")
    if (!account) return
    let active = true
    apiClient
      .taxRates()
      .then((loaded) => active && setRates(loaded))
      .catch(() => active && setRates([]))
    return () => {
      active = false
    }
  }, [account])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!account) return
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)
    try {
      const saved = await apiClient.updateBillingDetails(account.uuid, {
        billing_address: values.address.trim() || null,
        tax_number: values.taxNumber.trim() || null,
        tax_rate_uuid: values.rate === NO_TAX ? null : values.rate,
      })
      toast.success(`Billing details for ${account.name} saved`)
      onSaved(saved)
      onClose()
    } catch (error) {
      const fields = validationErrors(error)
      setErrors(fields)
      setFormError(!fields)
    } finally {
      setIsSubmitting(false)
    }
  }

  const field = (key: string) => fieldMessages(errors, key)?.join(" ")
  // Archived rates cannot be newly chosen, but the account's own stays on the list.
  const choosable = (rates ?? []).filter((rate) => !rate.archived || rate.uuid === baseline.rate)
  const matches = choosable.filter((rate) => rate.name.toLowerCase().includes(search.trim().toLowerCase()))
  const selected = choosable.find((rate) => rate.uuid === values.rate)

  return (
    <>
      <Dialog open={account !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>Billing details for {account?.name}</DialogTitle>
            <DialogDescription>
              Shown on its invoices. Drafts pick changes up when recalculated; issued invoices keep what they were issued
              with.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <TextareaField
                label="Billing address"
                value={values.address}
                maxLength={1000}
                rows={3}
                optional
                error={field("billing_address")}
                onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))}
              />
              <TextField
                label="Tax number"
                value={values.taxNumber}
                maxLength={64}
                optional
                help="The customer's own tax registration, if they have one."
                error={field("tax_number")}
                onChange={(event) => setValues((current) => ({ ...current, taxNumber: event.target.value }))}
              />
              <SearchableSelect
                label="Tax rate"
                value={values.rate}
                selectedLabel={values.rate === NO_TAX ? "No tax" : selected ? rateLabel(selected) : undefined}
                placeholder="Choose a tax rate"
                emptyText={rates === null ? "Loading tax rates…" : "No tax rates match. Add them in Settings → Billing."}
                loading={rates === null}
                search={search}
                onSearchChange={setSearch}
                options={[
                  ...(!search || "no tax".includes(search.trim().toLowerCase()) ? [{ value: NO_TAX, label: "No tax" }] : []),
                  ...matches.map((rate) => ({ value: rate.uuid, label: rateLabel(rate) })),
                ]}
                error={field("tax_rate_uuid")}
                onChange={(rate) => setValues((current) => ({ ...current, rate }))}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Could not save these billing details. Try again.</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save billing details"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
