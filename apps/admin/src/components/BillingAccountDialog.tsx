import { FormEvent, useEffect, useState } from "react"
import type { BillingAccountDetail, BillingAccountSummary } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { Textarea } from "@iot-os/ui/components/textarea"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"

type Editable = Pick<BillingAccountSummary, "uuid" | "name" | "contact_email"> & {
  notes?: string | null
}

const empty = { name: "", contact_email: "", notes: "" }

/**
 * Create (account "new") or edit a billing account's details. Its organization limit
 * is the `organizations` allowance, changed on the account's page (ADR-035).
 */
export function BillingAccountDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Editable | "new" | null
  onClose: () => void
  onSaved: (account: BillingAccountDetail) => void
}) {
  const isNew = account === "new"
  const baseline =
    account && account !== "new"
      ? {
          name: account.name,
          contact_email: account.contact_email ?? "",
          notes: account.notes ?? "",
        }
      : empty
  const [values, setValues] = useState(baseline)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dirty =
    account !== null && (Object.keys(baseline) as (keyof typeof baseline)[]).some((key) => values[key] !== baseline[key])
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard billing account changes?",
    description: "Your edits to this billing account are not saved.",
  })

  useEffect(() => {
    setValues(baseline)
    setErrors(null)
    setFormError(false)
  }, [account])

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  function set(key: keyof typeof empty, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!account) return
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)

    try {
      const payload = {
        name: values.name.trim(),
        contact_email: values.contact_email.trim() || null,
        notes: values.notes.trim() || null,
      }
      const saved =
        account === "new"
          ? await apiClient.createBillingAccount(payload)
          : await apiClient.updateBillingAccount(account.uuid, payload)
      toast.success(isNew ? `${saved.name} created` : `${saved.name} saved`)
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
      <Dialog open={account !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={!isSubmitting} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{isNew ? "New billing account" : "Edit billing account"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={Boolean(field("name"))}>
                <FieldLabel htmlFor="billing-account-name">Name</FieldLabel>
                <Input
                  id="billing-account-name"
                  value={values.name}
                  autoComplete="off"
                  maxLength={255}
                  required
                  aria-invalid={Boolean(field("name"))}
                  onChange={(event) => set("name", event.target.value)}
                />
                <FieldError errors={field("name")} />
              </Field>
              <Field data-invalid={Boolean(field("contact_email"))}>
                <FieldLabel htmlFor="billing-account-email">
                  Billing contact email <span className="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Input
                  id="billing-account-email"
                  type="email"
                  value={values.contact_email}
                  autoComplete="off"
                  maxLength={255}
                  aria-invalid={Boolean(field("contact_email"))}
                  onChange={(event) => set("contact_email", event.target.value)}
                />
                <FieldError errors={field("contact_email")} />
              </Field>
              <Field data-invalid={Boolean(field("notes"))}>
                <FieldLabel htmlFor="billing-account-notes">
                  Notes <span className="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Textarea
                  id="billing-account-notes"
                  value={values.notes}
                  maxLength={2000}
                  rows={3}
                  aria-invalid={Boolean(field("notes"))}
                  onChange={(event) => set("notes", event.target.value)}
                />
                <FieldError errors={field("notes")} />
              </Field>
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Could not save this billing account. Try again.</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : isNew ? "Create billing account" : "Save billing account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  )
}
