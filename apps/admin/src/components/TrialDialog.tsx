import { FormEvent, useEffect, useState } from "react"
import type { BillingAccountDetail, DirectoryQuery, RetentionNeedsConfirmation } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { TextField } from "@iot-os/ui/components/form-fields"
import { RadioGroup } from "@iot-os/ui/components/radio-group"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { trialEndsAt, trialLastDay } from "@iot-os/ui/lib/trials"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { useSearchOptions } from "../hooks/use-search-options"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"
import { retentionConfirmation } from "./RetentionConfirmDialog"

const DAY = 86_400_000

/** A UTC day `days` from today, as `YYYY-MM-DD`. */
const utcDay = (days = 0) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)

/** How long a trial lasts: until a UTC day, its last, or with no end date. */
export type TrialLengthValue = { open: boolean; lastDay: string }

/** A 30-day trial, today included. */
export const defaultTrialLength = (): TrialLengthValue => ({ open: false, lastDay: utcDay(29) })

/** What the API takes as `ends_at`: 00:00 UTC the day after the last day, or null. */
export const trialEndsAtOf = (length: TrialLengthValue) => (length.open ? null : trialEndsAt(length.lastDay))

/**
 * The trial's end: a last day, after which a saved card is charged, or **No end date**
 * (spec 029 US8). Also used when creating an organization with a new account.
 */
export function TrialLengthFields({
  value,
  onChange,
  error,
  disabled,
}: {
  value: TrialLengthValue
  onChange: (value: TrialLengthValue) => void
  error?: string
  disabled?: boolean
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Length</FieldLegend>
      <RadioGroup
        value={value.open ? "open" : "until"}
        onValueChange={(mode) => onChange({ ...value, open: mode === "open" })}
        disabled={disabled}
        className="gap-2"
      >
        <ChoiceCard value="until" title="Until a date" description="Then it continues on the plan, charged once a card is saved." />
        <ChoiceCard value="open" title="No end date" description="It lasts until an administrator ends it." />
      </RadioGroup>
      {value.open ? null : (
        <TextField
          label="Last day (UTC)"
          type="date"
          value={value.lastDay}
          min={utcDay()}
          className="max-w-48"
          required
          disabled={disabled}
          help="Owners are emailed 7 days and 1 day before. With a card, charging starts the next day."
          error={error}
          onChange={(event) => onChange({ ...value, lastDay: event.target.value })}
        />
      )}
    </FieldSet>
  )
}

function loadPlans(query: DirectoryQuery) {
  return apiClient.adminPlans({ ...query, archived: false })
}

/**
 * Starts a trial on a billing account, or changes the open one (spec 029 US8): its plan,
 * the account's own by default, and its end date or none. A plan that shortens telemetry
 * retention goes to the page's confirmation first.
 */
export function TrialDialog({
  account,
  mode,
  open,
  onClose,
  onSaved,
  onRetention,
}: {
  account: BillingAccountDetail
  mode: "start" | "change"
  open: boolean
  onClose: () => void
  onSaved: (account: BillingAccountDetail) => void
  onRetention: (confirmation: RetentionNeedsConfirmation, apply: () => Promise<void>) => void
}) {
  const assignment = account.plan_assignment
  const current = assignment && !assignment.plan.archived ? { uuid: assignment.plan.uuid, name: assignment.plan.name } : null
  const baseline = {
    plan: current,
    length:
      mode === "change" && assignment
        ? { open: assignment.trial_ends_at === null, lastDay: assignment.trial_ends_at ? trialLastDay(assignment.trial_ends_at) : utcDay(29) }
        : defaultTrialLength(),
  }
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const plans = useSearchOptions(loadPlans, open)
  const dirty =
    open &&
    (values.plan?.uuid !== baseline.plan?.uuid ||
      values.length.open !== baseline.length.open ||
      (!values.length.open && values.length.lastDay !== baseline.length.lastDay))
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: mode === "start" ? "Discard this trial?" : "Discard these changes?",
    description: mode === "start" ? "No trial is started." : "The trial stays as it was.",
  })

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(null)
  }, [open])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  function save(confirmRetention = false) {
    const body = {
      plan_uuid: values.plan?.uuid ?? null,
      ends_at: trialEndsAtOf(values.length),
      ...(confirmRetention ? { confirm_retention: true } : {}),
    }
    return mode === "start" ? apiClient.startTrial(account.uuid, body) : apiClient.changeTrial(account.uuid, body)
  }

  function saved(next: BillingAccountDetail) {
    const trial = next.plan_assignment
    toast.success(mode === "start" ? `${account.name} is on a trial of ${trial?.plan.name}` : "Trial changed")
    onSaved(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!values.plan) {
      setErrors({ plan_uuid: ["Choose a plan for the trial."] })
      return
    }
    setErrors(null)
    setFormError(null)
    setIsSubmitting(true)
    try {
      saved(await save())
      onClose()
    } catch (error) {
      const shortens = retentionConfirmation(error)
      if (shortens) {
        onClose()
        onRetention(shortens, async () => saved(await save(true)))
        return
      }
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
        <DialogContent showCloseButton={!isSubmitting} className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === "start" ? `Start a trial for ${account.name}` : `Change the trial of ${account.name}`}</DialogTitle>
            <DialogDescription>
              {mode === "start"
                ? "It starts now. The plan's allowances and limits apply as usual, and no trial day is charged."
                : "Extend or shorten it, or move it to another plan. It applies now."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <SearchableSelect
                label="Plan"
                value={values.plan?.uuid ?? ""}
                selectedLabel={values.plan?.name}
                placeholder="Choose a plan"
                emptyText={plans.failed ? "Plans could not be loaded." : "No plans match."}
                disabled={isSubmitting}
                {...plans.select}
                options={plans.items.map((plan) => ({ value: plan.uuid, label: plan.name }))}
                onChange={(uuid) => {
                  const plan = plans.items.find((item) => item.uuid === uuid)
                  setValues((current) => ({ ...current, plan: plan ? { uuid: plan.uuid, name: plan.name } : current.plan }))
                }}
                error={field("plan_uuid")}
              />
              <TrialLengthFields
                value={values.length}
                disabled={isSubmitting}
                error={field("ends_at")}
                onChange={(length) => setValues((current) => ({ ...current, length }))}
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
                {isSubmitting ? "Saving…" : mode === "start" ? "Start trial" : "Save trial"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
