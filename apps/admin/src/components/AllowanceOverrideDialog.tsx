import { FormEvent, useEffect, useState } from "react"
import type { Allowance, BillingAccountDetail } from "@iot-os/api-client"
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"
import { Switch } from "@iot-os/ui/components/switch"
import { Textarea } from "@iot-os/ui/components/textarea"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { allowanceMaximum, allowanceText, allowanceValue, allowsUnlimited } from "../lib/allowances"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"

const sourceText = { override: "an override", plan: "its plan", default: "the deployment default" }

/**
 * Replace one allowance for this billing account only (spec 028 US2). The override
 * survives plan changes until it is removed; its note says why it was agreed.
 */
export function AllowanceOverrideDialog({
  account,
  allowance,
  onClose,
  onSaved,
}: {
  account: Pick<BillingAccountDetail, "uuid" | "name">
  allowance: Allowance | null
  onClose: () => void
  onSaved: (account: BillingAccountDetail) => void
}) {
  const kind = allowance?.kind ?? "alerts"
  const baseline = {
    value: allowance?.value === null || allowance === null ? "" : String(allowance.value),
    unlimited: allowance !== null && allowance.value === null && allowsUnlimited(kind),
    note: allowance?.source === "override" ? (allowance.note ?? "") : "",
  }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty =
    allowance !== null &&
    (values.value !== baseline.value || values.unlimited !== baseline.unlimited || values.note !== baseline.note)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard this override?",
    description: "The allowance is not changed.",
  })

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(false)
  }, [allowance])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!allowance) return
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)

    try {
      const value = values.unlimited ? null : values.value.trim() === "" ? Number.NaN : Number.parseInt(values.value, 10)
      if (Number.isNaN(value)) {
        setErrors({ value: ["Enter a whole number, or choose unlimited."] })
        return
      }
      const saved = await apiClient.overrideAllowance(account.uuid, kind, { value, note: values.note.trim() })
      toast.success(`${allowanceText[kind].label} for ${account.name} is now ${allowanceValue(kind, value)}`)
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

  const field = (key: string) => fieldMessages(errors, key)?.map((message) => ({ message }))

  return (
    <>
      <Dialog open={allowance !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>Override {allowanceText[kind].label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              {allowance
                ? `Now ${allowanceValue(kind, allowance.value)}, from ${sourceText[allowance.source]}. An override stays when the plan changes.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={Boolean(field("value"))}>
                <FieldLabel htmlFor="override-value">{allowanceText[kind].label}</FieldLabel>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Input
                    id="override-value"
                    type="number"
                    inputMode="numeric"
                    min={kind === "retention_days" ? 1 : 0}
                    max={allowanceMaximum[kind]}
                    step={1}
                    className="max-w-40 tabular-nums"
                    placeholder={values.unlimited ? "Unlimited" : undefined}
                    value={values.unlimited ? "" : values.value}
                    disabled={values.unlimited}
                    required={!values.unlimited}
                    aria-invalid={Boolean(field("value"))}
                    aria-describedby="override-value-help"
                    onChange={(event) => setValues((current) => ({ ...current, value: event.target.value }))}
                  />
                  {allowsUnlimited(kind) ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="override-unlimited"
                        checked={values.unlimited}
                        onCheckedChange={(unlimited) => setValues((current) => ({ ...current, unlimited }))}
                      />
                      <Label htmlFor="override-unlimited" className="font-normal">
                        Unlimited
                      </Label>
                    </div>
                  ) : null}
                </div>
                <FieldDescription id="override-value-help">{allowanceText[kind].help}</FieldDescription>
                <FieldError errors={field("value")} />
              </Field>
              <Field data-invalid={Boolean(field("note"))}>
                <FieldLabel htmlFor="override-note">Note</FieldLabel>
                <Textarea
                  id="override-note"
                  value={values.note}
                  maxLength={1000}
                  rows={2}
                  required
                  aria-invalid={Boolean(field("note"))}
                  aria-describedby="override-note-help"
                  onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))}
                />
                <FieldDescription id="override-note-help">Why it was agreed, for whoever looks next.</FieldDescription>
                <FieldError errors={field("note")} />
              </Field>
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
