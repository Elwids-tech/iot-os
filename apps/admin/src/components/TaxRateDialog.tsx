import { FormEvent, useEffect, useState } from "react"
import type { TaxRate } from "@iot-os/api-client"
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
import { TextField } from "@iot-os/ui/components/form-fields"
import { parseBasisPoints } from "@iot-os/ui/lib/money"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"

/**
 * Add or change a named tax rate (spec 029 FR-029). The percentage is stored as basis
 * points; a changed rate applies to drafts from now on, never to issued invoices.
 */
export function TaxRateDialog({
  rate,
  onClose,
  onSaved,
}: {
  rate: TaxRate | "new" | null
  onClose: () => void
  onSaved: (rate: TaxRate) => void
}) {
  const existing = rate !== null && rate !== "new" ? rate : null
  const baseline = {
    name: existing?.name ?? "",
    percentage: existing ? String(existing.basis_points / 100) : "",
  }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty = rate !== null && (values.name !== baseline.name || values.percentage !== baseline.percentage)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this tax rate?",
    description: "Nothing is saved.",
  })

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(false)
  }, [rate])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const basisPoints = parseBasisPoints(values.percentage)
    if (basisPoints === null) {
      setErrors({ basis_points: ["Enter a percentage from 0 to 100, with up to two decimals."] })
      return
    }
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)
    try {
      const body = { name: values.name.trim(), basis_points: basisPoints }
      const saved = existing ? await apiClient.updateTaxRate(existing.uuid, body) : await apiClient.createTaxRate(body)
      toast.success(existing ? `${saved.name} saved` : `${saved.name} added`)
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

  return (
    <>
      <Dialog open={rate !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.name}` : "Add a tax rate"}</DialogTitle>
            <DialogDescription>
              {existing
                ? "A new percentage applies to drafts from now on. Issued invoices keep the rate they were issued with."
                : "Give billing accounts this rate on their page. Tax is charged on each invoice's subtotal."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <TextField
                label="Name"
                value={values.name}
                maxLength={100}
                required
                help="As it appears on invoices, such as Sales tax."
                error={field("name")}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              />
              <TextField
                label="Percentage"
                value={values.percentage}
                inputMode="decimal"
                className="max-w-32 tabular-nums"
                required
                help="Up to two decimals, such as 8.25."
                error={field("basis_points")}
                onChange={(event) => setValues((current) => ({ ...current, percentage: event.target.value }))}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Could not save this tax rate. Try again.</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : existing ? "Save tax rate" : "Add tax rate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
