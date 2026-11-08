import { FormEvent, useEffect, useState } from "react"
import type { BillingPlanDetail, PlanPriceValues } from "@iot-os/api-client"
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
import { formatDay } from "@iot-os/ui/lib/invoices"
import { moneyInput, parseMoney } from "@iot-os/ui/lib/money"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"
import { nextMonthStart, priceKinds, priceText } from "../lib/invoices"

/**
 * A plan's prices (spec 029 FR-027, FR-028): a monthly base price and the prices of
 * alerts and data point blocks over the allowances. They apply from the first day of
 * next month; this month's invoices keep this month's prices.
 */
export function PlanPricesDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: BillingPlanDetail | null
  onClose: () => void
  onSaved: (plan: BillingPlanDetail) => void
}) {
  const currency = plan?.prices.currency ?? "USD"
  const shown = plan ? (plan.prices.next ?? plan.prices.current) : null
  const baseline = {
    base_price: shown ? moneyInput(shown.base_price, currency) : "",
    alert_overage_price: shown ? moneyInput(shown.alert_overage_price, currency) : "",
    data_point_overage_price: shown ? moneyInput(shown.data_point_overage_price, currency) : "",
    data_point_block_size: shown ? String(shown.data_point_block_size) : "",
  }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty = plan !== null && (Object.keys(baseline) as (keyof typeof baseline)[]).some((key) => values[key] !== baseline[key])
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard these prices?",
    description: "The plan keeps its prices.",
  })
  const from = formatDay(nextMonthStart())

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(false)
  }, [plan])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan) return
    const parsed: Record<string, number | null> = Object.fromEntries(
      priceKinds.map((kind) => [kind, parseMoney(values[kind], currency)]),
    )
    const blockSize = /^\d+$/.test(values.data_point_block_size.trim()) ? Number(values.data_point_block_size) : null
    const invalid: Record<string, string[]> = {}
    for (const kind of priceKinds) if (parsed[kind] === null) invalid[kind] = [`Enter an amount of 0 or more in ${currency}.`]
    if (!blockSize) invalid.data_point_block_size = ["Enter a whole number of data points, 1 or more."]
    if (Object.keys(invalid).length) {
      setErrors(invalid)
      return
    }
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)
    try {
      const body = { ...parsed, data_point_block_size: blockSize } as PlanPriceValues
      const saved = await apiClient.setPlanPrices(plan.uuid, body)
      toast.success(`Prices for ${plan.name} apply from ${formatDay(saved.effective_from)}`)
      onSaved(saved.plan)
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
      <Dialog open={plan !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={!isSubmitting}>
          <DialogHeader>
            <DialogTitle>Prices for {plan?.name}</DialogTitle>
            <DialogDescription>
              Applies from {from}. Invoices for this month keep this month&apos;s prices. Amounts are in {currency}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              {priceKinds.map((kind) => (
                <TextField
                  key={kind}
                  label={priceText[kind].label}
                  value={values[kind]}
                  inputMode="decimal"
                  className="max-w-40 tabular-nums"
                  required
                  help={priceText[kind].help}
                  error={field(kind)}
                  onChange={(event) => setValues((current) => ({ ...current, [kind]: event.target.value }))}
                />
              ))}
              <TextField
                label="Data points in a block"
                value={values.data_point_block_size}
                inputMode="numeric"
                className="max-w-40 tabular-nums"
                required
                help="The block the data point price is for, such as 1000000."
                error={field("data_point_block_size")}
                onChange={(event) => setValues((current) => ({ ...current, data_point_block_size: event.target.value }))}
              />
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Could not save these prices. Try again.</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : `Apply from ${from}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
