import { FormEvent, useEffect, useState } from "react"
import { ApiError, type AllowanceKind, type BillingPlan, type BillingPlanDetail } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"
import { Switch } from "@iot-os/ui/components/switch"
import { Textarea } from "@iot-os/ui/components/textarea"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { allowanceKinds, allowanceMaximum, allowanceText, allowsUnlimited } from "../lib/allowances"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"

/** One allowance in the form: empty and limited means the deployment default. */
type AllowanceInput = { value: string; unlimited: boolean }

type Values = { name: string; description: string; allowances: Record<AllowanceKind, AllowanceInput> }

function valuesOf(plan: BillingPlan | null): Values {
  const set = new Map(plan?.allowances.map((allowance) => [allowance.kind, allowance.value]))
  return {
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    allowances: Object.fromEntries(
      allowanceKinds.map((kind) => {
        const value = set.get(kind)
        return [kind, { value: value === undefined || value === null ? "" : String(value), unlimited: set.has(kind) && value === null }]
      }),
    ) as Record<AllowanceKind, AllowanceInput>,
  }
}

/** The complete set the API takes: kinds left empty fall back to the deployment default. */
function allowancesOf(values: Values): Partial<Record<AllowanceKind, number | null>> {
  const allowances: Partial<Record<AllowanceKind, number | null>> = {}
  for (const kind of allowanceKinds) {
    const input = values.allowances[kind]
    if (input.unlimited) allowances[kind] = null
    else if (input.value.trim() !== "") allowances[kind] = Number.parseInt(input.value, 10)
  }
  return allowances
}

const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Create (plan "new") or edit a plan (spec 028 US1). Editing the allowances of a plan
 * billing accounts are on asks first: the API answers 409 with how many it changes.
 */
export function PlanDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: BillingPlan | "new" | null
  onClose: () => void
  onSaved: (plan: BillingPlanDetail) => void
}) {
  const isNew = plan === "new"
  const baseline = valuesOf(plan && plan !== "new" ? plan : null)
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [affected, setAffected] = useState<number | null>(null)
  const dirty = plan !== null && !same(values, baseline)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard plan changes?",
    description: "Your edits to this plan are not saved.",
  })

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(null)
    setAffected(null)
  }, [plan])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  function setAllowance(kind: AllowanceKind, input: Partial<AllowanceInput>) {
    setValues((current) => ({
      ...current,
      allowances: { ...current.allowances, [kind]: { ...current.allowances[kind], ...input } },
    }))
  }

  async function save(confirmAffected?: number) {
    if (!plan) return
    setErrors(null)
    setFormError(null)
    setIsSubmitting(true)

    try {
      const payload = {
        name: values.name.trim(),
        description: values.description.trim() || null,
        allowances: allowancesOf(values),
      }
      const saved =
        plan === "new" ? await apiClient.createPlan(payload) : await apiClient.updatePlan(plan.uuid, payload, confirmAffected)
      toast.success(isNew ? `${saved.name} created` : `${saved.name} saved`)
      setAffected(null)
      onSaved(saved)
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const count = (error.payload as { affected_accounts?: number } | null)?.affected_accounts
        if (typeof count === "number") {
          setAffected(count)
          return
        }
      }
      setAffected(null)
      const fields = validationErrors(error)
      setErrors(fields)
      setFormError(fields ? null : "Could not save this plan. Try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save()
  }

  const field = (key: string) => fieldMessages(errors, key)?.map((message) => ({ message }))

  return (
    <>
      <Dialog open={plan !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent
          showCloseButton={!isSubmitting}
          aria-describedby={undefined}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{isNew ? "New plan" : "Edit plan"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={Boolean(field("name"))}>
                <FieldLabel htmlFor="plan-name">Name</FieldLabel>
                <Input
                  id="plan-name"
                  value={values.name}
                  autoComplete="off"
                  maxLength={120}
                  required
                  aria-invalid={Boolean(field("name"))}
                  onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
                />
                <FieldError errors={field("name")} />
              </Field>
              <Field data-invalid={Boolean(field("description"))}>
                <FieldLabel htmlFor="plan-description" optional>
                  Description
                </FieldLabel>
                <Textarea
                  id="plan-description"
                  value={values.description}
                  maxLength={2000}
                  rows={2}
                  aria-invalid={Boolean(field("description"))}
                  onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
                />
                <FieldError errors={field("description")} />
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Allowances</FieldLegend>
                <FieldDescription>Leave a value empty to use the deployment&apos;s default.</FieldDescription>
                <FieldGroup>
                  {allowanceKinds.map((kind) => {
                    const input = values.allowances[kind]
                    const id = `plan-allowance-${kind}`
                    const kindErrors = field(`allowances.${kind}`)
                    return (
                      <Field key={kind} data-invalid={Boolean(kindErrors)}>
                        <FieldLabel htmlFor={id}>{allowanceText[kind].label}</FieldLabel>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <Input
                            id={id}
                            type="number"
                            inputMode="numeric"
                            min={kind === "retention_days" ? 1 : 0}
                            max={allowanceMaximum[kind]}
                            step={1}
                            className="max-w-40 tabular-nums"
                            placeholder={
                              input.unlimited ? "Unlimited" : kind === "retention_days" ? "Platform setting" : "Default"
                            }
                            value={input.unlimited ? "" : input.value}
                            disabled={input.unlimited}
                            aria-invalid={Boolean(kindErrors)}
                            aria-describedby={`${id}-help`}
                            onChange={(event) => setAllowance(kind, { value: event.target.value })}
                          />
                          {allowsUnlimited(kind) ? (
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`${id}-unlimited`}
                                checked={input.unlimited}
                                aria-label={`${allowanceText[kind].label}: unlimited`}
                                onCheckedChange={(unlimited) => setAllowance(kind, { unlimited })}
                              />
                              <Label htmlFor={`${id}-unlimited`} className="font-normal">
                                Unlimited
                              </Label>
                            </div>
                          ) : null}
                        </div>
                        <FieldDescription id={`${id}-help`}>{allowanceText[kind].help}</FieldDescription>
                        <FieldError errors={kindErrors} />
                      </Field>
                    )
                  })}
                </FieldGroup>
              </FieldSet>
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
                {isSubmitting ? "Saving…" : isNew ? "Create plan" : "Save plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={affected !== null} onOpenChange={(open) => !open && !isSubmitting && setAffected(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              This changes {affected} billing {affected === 1 ? "account" : "accounts"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every account on this plan gets the new allowances now, except where it has an override. To keep
              accounts on the current terms, create a new plan instead and archive this one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Keep editing</AlertDialogCancel>
            <Button disabled={isSubmitting} onClick={() => affected !== null && void save(affected)}>
              {isSubmitting ? "Saving…" : `Change ${affected} ${affected === 1 ? "account" : "accounts"}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {discardDialog}
    </>
  )
}
