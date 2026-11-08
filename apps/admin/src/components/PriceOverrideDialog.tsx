import { FormEvent, useEffect, useState } from "react"
import type { BillingAccountDetail, PriceOverride } from "@iot-os/api-client"
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
import { formatDay } from "@iot-os/ui/lib/invoices"
import { moneyInput, parseMoney } from "@iot-os/ui/lib/money"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"
import { nextMonthStart, priceText } from "../lib/invoices"

/**
 * Replace one of the plan's prices for this account only (spec 029 FR-028), from the
 * first day of next month, with a note saying why it was agreed.
 */
export function PriceOverrideDialog({
  account,
  currency,
  price,
  onClose,
  onSaved,
}: {
  account: Pick<BillingAccountDetail, "uuid" | "name">
  currency: string
  price: PriceOverride | null
  onClose: () => void
  onSaved: (account: BillingAccountDetail) => void
}) {
  const kind = price?.price ?? "base_price"
  // Next month's override when one waits, else this month's.
  const pending = price ? (price.next_value !== price.value || price.next_note !== price.note) : false
  const current = price ? (pending ? price.next_value : price.value) : null
  const baseline = {
    value: current === null ? "" : moneyInput(current, currency),
    note: (price ? (pending ? price.next_note : price.note) : null) ?? "",
  }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty = price !== null && (values.value !== baseline.value || values.note !== baseline.note)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this price override?",
    description: "The price is not changed.",
  })
  const from = formatDay(nextMonthStart())

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(false)
  }, [price])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!price) return
    const value = parseMoney(values.value, currency)
    if (value === null) {
      setErrors({ value: [`Enter an amount of 0 or more in ${currency}.`] })
      return
    }
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)
    try {
      const saved = await apiClient.overridePrice(account.uuid, kind, { value, note: values.note.trim() })
      toast.success(`${priceText[kind].label} for ${account.name} changes from ${formatDay(saved.effective_from)}`)
      onSaved(saved.account)
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

  return (
    <>
      <Dialog open={price !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>Override {priceText[kind].label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              For {account.name} only, from {from}. It stays when the plan&apos;s prices change, until it is removed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <TextField
                label={`${priceText[kind].label} (${currency})`}
                value={values.value}
                inputMode="decimal"
                className="max-w-40 tabular-nums"
                required
                help={priceText[kind].help}
                error={field("value")}
                onChange={(event) => setValues((current) => ({ ...current, value: event.target.value }))}
              />
              <TextareaField
                label="Note"
                value={values.note}
                maxLength={1000}
                rows={2}
                required
                help="Why it was agreed, for whoever looks next."
                error={field("note")}
                onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Could not save this override. Try again.</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save override"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
