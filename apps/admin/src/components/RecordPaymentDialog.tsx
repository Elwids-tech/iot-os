import { FormEvent, useEffect, useState } from "react"
import type { InvoiceDetail } from "@iot-os/api-client"
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
import { formatMoney, moneyInput, parseMoney } from "@iot-os/ui/lib/money"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

/**
 * A payment made another way, such as a bank transfer (spec 029 FR-044), up to what is
 * still owed. It settles the invoice once nothing is owed, whether or not cards are on.
 */
export function RecordPaymentDialog({
  invoice,
  open,
  onClose,
  onSaved,
}: {
  invoice: InvoiceDetail
  open: boolean
  onClose: () => void
  onSaved: (invoice: InvoiceDetail) => void
}) {
  const baseline = { amount: moneyInput(invoice.outstanding, invoice.currency), note: "" }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty = open && (values.amount !== baseline.amount || values.note !== baseline.note)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this payment?",
    description: "Nothing is recorded.",
  })
  const money = (amount: number) => formatMoney(amount, invoice.currency)

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(null)
  }, [open])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = parseMoney(values.amount, invoice.currency)
    if (!amount || amount > invoice.outstanding) {
      setErrors({ amount: [`Enter an amount above 0 and up to ${money(invoice.outstanding)}, what is still owed.`] })
      return
    }
    if (!values.note.trim()) {
      setErrors({ note: ["Say how it was paid, such as the transfer's reference."] })
      return
    }
    setErrors(null)
    setFormError(null)
    setIsSubmitting(true)
    try {
      const saved = await apiClient.recordInvoicePayment(invoice.uuid, { amount, note: values.note.trim() })
      toast.success(`Payment of ${money(amount)} recorded`)
      onSaved(saved)
      onClose()
    } catch (error) {
      const fields = validationErrors(error)
      setErrors(fields)
      if (!fields) setFormError(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const field = (key: string) => fieldMessages(errors, key)?.join(" ")

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>Record a payment on {invoice.number}</DialogTitle>
            <DialogDescription>
              For a payment made another way, such as a bank transfer. {money(invoice.outstanding)} is still owed; the invoice
              reads paid once nothing is.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <TextField
                label={`Amount (${invoice.currency})`}
                value={values.amount}
                inputMode="decimal"
                className="max-w-40 tabular-nums"
                required
                error={field("amount")}
                onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))}
              />
              <TextareaField
                label="Note"
                value={values.note}
                maxLength={1000}
                rows={2}
                required
                help="How it was paid, such as the transfer's reference. Owners never see it."
                error={field("note")}
                onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Recording…" : "Record payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
