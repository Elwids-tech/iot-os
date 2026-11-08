import { FormEvent, useEffect, useState } from "react"
import { ApiError, type InvoiceDetail } from "@iot-os/api-client"
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
import { SelectField, TextareaField } from "@iot-os/ui/components/form-fields"
import { usageMonths } from "@iot-os/ui/components/usage-overview"
import { formatMonth } from "@iot-os/ui/lib/invoices"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

/** Draft for this account; `month` (`YYYY-MM`) fixes the month, as Draft anyway does. */
export type DraftTarget = { account: { uuid: string; name: string }; month?: string }

/**
 * Draft a month's invoice now, before its usage is final (spec 029 FR-033), with a note
 * saying why. The draft says its usage may be incomplete until a recalculation finds the
 * month final.
 */
export function DraftInvoiceDialog({
  target,
  onClose,
  onDrafted,
}: {
  target: DraftTarget | null
  onClose: () => void
  onDrafted: (invoice: InvoiceDetail) => void
}) {
  const months = usageMonths(new Date(), 13)
  const baseline = { month: target?.month ?? months[1].value, note: "" }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [drafted, setDrafted] = useState<InvoiceDetail | null>(null)
  const dirty = target !== null && (values.month !== baseline.month || values.note !== baseline.note)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this draft?",
    description: "No invoice is drafted.",
  })

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(null)
  }, [target])

  // Hand the draft over once the dialog has closed, so its unsaved-changes guard is clear.
  useEffect(() => {
    if (drafted && target === null) {
      setDrafted(null)
      onDrafted(drafted)
    }
  }, [drafted, target, onDrafted])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target) return
    setErrors(null)
    setFormError(null)
    setIsSubmitting(true)
    try {
      const invoice = await apiClient.draftInvoice(target.account.uuid, { month: values.month, note: values.note.trim() })
      toast.success(`Drafted ${formatMonth(invoice.month)} for ${target.account.name}`)
      setDrafted(invoice)
      onClose()
    } catch (error) {
      const fields = validationErrors(error)
      setErrors(fields)
      if (!fields) setFormError(error instanceof ApiError && error.status === 409 ? errorMessage(error) : "Could not draft this invoice. Try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const field = (key: string) => fieldMessages(errors, key)?.join(" ")

  return (
    <>
      <Dialog open={target !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>
              {target?.month ? `Draft ${formatMonth(target.month)} anyway` : "Draft an invoice"} for {target?.account.name}
            </DialogTitle>
            <DialogDescription>
              Usage may not be final yet, so the draft says its usage may be incomplete. Recalculate it once the month is
              final, then review and issue it.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              {target?.month ? null : (
                <SelectField
                  label="Month"
                  value={values.month}
                  options={months}
                  help="Months are UTC."
                  error={field("month")}
                  onChange={(month) => setValues((current) => ({ ...current, month }))}
                />
              )}
              <TextareaField
                label="Note"
                value={values.note}
                maxLength={1000}
                rows={2}
                required
                help="Why it is drafted now. Only administrators see it."
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
                {isSubmitting ? "Drafting…" : "Draft invoice"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
