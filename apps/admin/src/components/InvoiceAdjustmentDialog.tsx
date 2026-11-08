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
import { SelectField, TextareaField, TextField } from "@iot-os/ui/components/form-fields"
import { formatMoney, parseMoney } from "@iot-os/ui/lib/money"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

const empty = { kind: "credit", description: "", amount: "", note: "" }

/**
 * A credit or a charge on a draft (spec 029 FR-034), such as a credit agreed for an
 * outage. The description is printed on the invoice; the note is for administrators.
 */
export function InvoiceAdjustmentDialog({
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
  const [values, setValues] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty = open && (values.kind !== empty.kind || values.description !== "" || values.amount !== "" || values.note !== "")
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this adjustment?",
    description: "The draft is not changed.",
  })

  useEffect(() => {
    setValues(empty)
    setErrors(null)
    setFormError(null)
  }, [open])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = parseMoney(values.amount, invoice.currency)
    if (!amount) {
      setErrors({ amount: [`Enter an amount above 0 in ${invoice.currency}.`] })
      return
    }
    setErrors(null)
    setFormError(null)
    setIsSubmitting(true)
    try {
      const signed = values.kind === "credit" ? -amount : amount
      const saved = await apiClient.addInvoiceAdjustment(invoice.uuid, {
        description: values.description.trim(),
        amount: signed,
        note: values.note.trim(),
      })
      toast.success(`${values.kind === "credit" ? "Credit" : "Charge"} of ${formatMoney(amount, invoice.currency)} added`)
      onSaved(saved)
      onClose()
    } catch (error) {
      const fields = validationErrors(error)
      setErrors(fields)
      if (!fields) setFormError(error instanceof ApiError && error.status === 409 ? errorMessage(error) : "Could not add this adjustment. Try again.")
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
            <DialogTitle>Add an adjustment</DialogTitle>
            <DialogDescription>
              It is added before tax. The description is printed on the invoice; the note is for administrators only.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <SelectField
                label="Kind"
                value={values.kind}
                options={[
                  { value: "credit", label: "Credit: takes the amount off" },
                  { value: "charge", label: "Charge: adds the amount" },
                ]}
                onChange={(kind) => setValues((current) => ({ ...current, kind }))}
              />
              <TextField
                label="Description"
                value={values.description}
                maxLength={255}
                required
                help="Such as Credit for the outage on 4 November."
                error={field("description")}
                onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
              />
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
                help="Why it was agreed. Owners never see it."
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
                {isSubmitting ? "Adding…" : "Add adjustment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
