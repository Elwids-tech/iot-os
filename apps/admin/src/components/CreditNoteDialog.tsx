import { FormEvent, useEffect, useState } from "react"
import type { CreditNote, InvoiceDetail } from "@iot-os/api-client"
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
import { fieldMessages, validationErrors } from "../lib/errors"

/** What can still be credited on an issued invoice: its total less earlier credit notes. */
export function creditable(invoice: InvoiceDetail): number {
  return invoice.total - invoice.credit_notes.reduce((sum, note) => sum + note.amount, 0)
}

/**
 * A credit note on an issued invoice (spec 029 FR-035), for part or all of it, with a
 * reason. It takes what it can off what the invoice still owes; the rest comes off the
 * account's next invoice. The issued invoice itself never changes.
 */
export function CreditNoteDialog({
  invoice,
  open,
  onClose,
  onIssued,
}: {
  invoice: InvoiceDetail
  open: boolean
  onClose: () => void
  onIssued: (note: CreditNote) => void
}) {
  const most = creditable(invoice)
  const baseline = { amount: moneyInput(Math.min(invoice.outstanding || most, most), invoice.currency), reason: "" }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty = open && (values.amount !== baseline.amount || values.reason !== baseline.reason)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this credit note?",
    description: "Nothing is issued.",
  })
  const money = (amount: number) => formatMoney(amount, invoice.currency)

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(false)
  }, [open])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = parseMoney(values.amount, invoice.currency)
    if (!amount || amount > most) {
      setErrors({ amount: [`Enter an amount above 0 and up to ${money(most)}.`] })
      return
    }
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)
    try {
      const note = await apiClient.issueCreditNote(invoice.uuid, { amount, reason: values.reason.trim() })
      toast.success(`Credit note ${note.number} issued for ${money(note.amount)}`)
      onIssued(note)
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
      <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>Credit note for {invoice.number}</DialogTitle>
            <DialogDescription>
              Up to {money(most)}. It first takes off what the invoice still owes ({money(invoice.outstanding)}); the rest
              comes off the account&apos;s next invoice. It is numbered and emailed to the billing contact and owners at once.
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
                label="Reason"
                value={values.reason}
                maxLength={1000}
                rows={2}
                required
                help="Printed on the credit note."
                error={field("reason")}
                onChange={(event) => setValues((current) => ({ ...current, reason: event.target.value }))}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Could not issue this credit note. Try again.</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Issuing…" : "Issue credit note"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
