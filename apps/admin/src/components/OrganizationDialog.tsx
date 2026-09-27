import { FormEvent, useEffect, useState } from "react"
import type { Organization } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { fieldMessages, validationErrors } from "../lib/errors"

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Create (organization "new") or edit an organization's name and slug. */
export function OrganizationDialog({
  organization,
  onClose,
  onSaved,
}: {
  organization: Organization | "new" | null
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = organization === "new"
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [formError, setFormError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const baseline = organization && organization !== "new" ? organization : { name: "", slug: "" }
  const dirty = organization !== null && (name !== baseline.name || slug !== baseline.slug)
  const { guard, dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard organization changes?",
    description: "Your edits to this organization are not saved.",
  })

  function cancel() {
    if (!isSubmitting) guard(onClose)
  }

  useEffect(() => {
    setName(baseline.name)
    setSlug(baseline.slug)
    setSlugTouched(!isNew)
    setErrors(null)
    setFormError(false)
  }, [organization, isNew])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organization) return
    setErrors(null)
    setFormError(false)
    setIsSubmitting(true)

    try {
      const values = { name: name.trim(), slug: slug.trim() }
      const saved =
        organization === "new"
          ? await apiClient.createAdminOrganization(values)
          : await apiClient.updateAdminOrganization(organization.uuid, values)
      toast.success(isNew ? `${saved.name} created` : `${saved.name} saved`)
      onSaved()
      onClose() // saved, so no discard prompt
    } catch (error) {
      const fields = validationErrors(error)
      setErrors(fields)
      setFormError(!fields)
    } finally {
      setIsSubmitting(false)
    }
  }

  const nameErrors = fieldMessages(errors, "name")
  const slugErrors = fieldMessages(errors, "slug")

  return (
    <>
    <Dialog
      open={organization !== null}
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
    >
      <DialogContent showCloseButton={!isSubmitting} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isNew ? "New organization" : "Edit organization"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={Boolean(nameErrors)}>
              <FieldLabel htmlFor="organization-name">Name</FieldLabel>
              <Input
                id="organization-name"
                value={name}
                autoComplete="off"
                maxLength={255}
                aria-invalid={Boolean(nameErrors)}
                onChange={(event) => {
                  setName(event.target.value)
                  if (!slugTouched) setSlug(slugify(event.target.value))
                }}
                required
              />
              <FieldError errors={nameErrors?.map((message) => ({ message }))} />
            </Field>
            <Field data-invalid={Boolean(slugErrors)}>
              <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
              <Input
                id="organization-slug"
                value={slug}
                autoComplete="off"
                spellCheck={false}
                maxLength={255}
                className="font-mono"
                aria-invalid={Boolean(slugErrors)}
                aria-describedby="organization-slug-help"
                onChange={(event) => {
                  setSlug(event.target.value)
                  setSlugTouched(true)
                }}
                required
              />
              <FieldDescription id="organization-slug-help">
                Letters, numbers, dashes and underscores.
              </FieldDescription>
              <FieldError errors={slugErrors?.map((message) => ({ message }))} />
            </Field>
            {formError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>Could not save this organization. Try again.</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={cancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isNew ? "Create organization" : "Save organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {discardDialog}
    </>
  )
}
