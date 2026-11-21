import * as React from "react"
import { AlertCircleIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { BrandMark } from "@iot-os/ui/components/brand-mark"
import { Button } from "@iot-os/ui/components/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { ImageField } from "@iot-os/ui/components/image-field"
import { Input } from "@iot-os/ui/components/input"

type Image = { url: string; width: number; height: number }

export type BrandEditorBrand = {
  product_name: string | null
  short_name: string | null
  support_url: string | null
  logo: Image | null
  logo_dark: Image | null
  icon: Image | null
  in_effect: boolean
  revision: number
}

export type BrandEditorRole = "logo" | "logo_dark" | "icon"

export type BrandEditorValues = Pick<BrandEditorBrand, "product_name" | "short_name" | "support_url" | "revision">

/** What a failed save or upload was: field messages, a message for the form, or a newer brand on the server. */
export type BrandEditorFailure = { fields?: Record<string, string[]>; message: string; conflict?: boolean }

const text = (brand: BrandEditorBrand) => ({
  product_name: brand.product_name ?? "",
  short_name: brand.short_name ?? "",
  support_url: brand.support_url ?? "",
})

/**
 * A billing account's brand: product name, short name, support link, logo, dark logo and
 * icon, with a preview of the sign-in card. The names and link are a draft until Save;
 * each image is saved when it is picked. The caller makes the requests and turns their
 * errors into `BrandEditorFailure`s; `onDirtyChange` lets it guard unsaved edits.
 */
export function BrandEditor({
  brand,
  limits,
  platformName,
  disabled = false,
  idPrefix = "brand",
  onSave,
  onImage,
  onRemoveImage,
  onChange,
  onReload,
  onDirtyChange,
  describeError,
}: {
  brand: BrandEditorBrand
  limits: { image_bytes: number; types: string[]; icon_min: number }
  /** Shown in the preview where the brand has no name, and in "Powered by". */
  platformName: string
  disabled?: boolean
  idPrefix?: string
  onSave: (values: BrandEditorValues) => Promise<BrandEditorBrand>
  onImage: (role: BrandEditorRole, file: File) => Promise<BrandEditorBrand>
  onRemoveImage: (role: BrandEditorRole) => Promise<BrandEditorBrand>
  /** The brand after a save, an upload or a removal. */
  onChange: (brand: BrandEditorBrand) => void
  /** Reads the brand again after someone else changed it. */
  onReload: () => void
  onDirtyChange?: (dirty: boolean) => void
  describeError: (error: unknown) => BrandEditorFailure
}) {
  const [values, setValues] = React.useState(() => text(brand))
  const [failure, setFailure] = React.useState<BrandEditorFailure | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [busy, setBusy] = React.useState<BrandEditorRole | null>(null)
  const [imageErrors, setImageErrors] = React.useState<Partial<Record<BrandEditorRole, string>>>({})
  const saved = text(brand)
  const dirty = values.product_name !== saved.product_name || values.short_name !== saved.short_name || values.support_url !== saved.support_url

  // A reload replaces the draft with what is saved now.
  const reloaded = React.useRef(false)
  React.useEffect(() => {
    if (!reloaded.current) return
    reloaded.current = false
    setValues(text(brand))
    setFailure(null)
  }, [brand])
  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFailure(null)
    setSaving(true)
    try {
      const next = await onSave({
        product_name: values.product_name.trim() || null,
        short_name: values.short_name.trim() || null,
        support_url: values.support_url.trim() || null,
        revision: brand.revision,
      })
      setValues(text(next))
      onChange(next)
    } catch (error) {
      setFailure(describeError(error))
    } finally {
      setSaving(false)
    }
  }

  async function changeImage(role: BrandEditorRole, change: () => Promise<BrandEditorBrand>) {
    setImageErrors((current) => ({ ...current, [role]: undefined }))
    setBusy(role)
    try {
      onChange(await change())
    } catch (error) {
      setImageErrors((current) => ({ ...current, [role]: describeError(error).message }))
    } finally {
      setBusy(null)
    }
  }

  const errors = (field: string) => failure?.fields?.[field]?.map((message) => ({ message }))
  const name = values.product_name.trim() || platformName
  const image = (role: BrandEditorRole, label: string, description: string, options: { shape?: "wide" | "square"; surface?: "page" | "dark" } = {}) => (
    <ImageField
      id={`${idPrefix}-${role}`}
      label={label}
      description={description}
      value={brand[role]}
      accept={limits.types}
      maxBytes={limits.image_bytes}
      busy={busy === role}
      disabled={disabled || (busy !== null && busy !== role)}
      error={imageErrors[role]}
      onSelect={(file) => void changeImage(role, () => onImage(role, file))}
      onRemove={() => void changeImage(role, () => onRemoveImage(role))}
      {...options}
    />
  )

  return (
    <div data-slot="brand-editor" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <form onSubmit={save} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors("product_name"))}>
              <FieldLabel htmlFor={`${idPrefix}-product-name`}>Product name</FieldLabel>
              <Input
                id={`${idPrefix}-product-name`}
                value={values.product_name}
                maxLength={40}
                disabled={disabled || saving}
                aria-invalid={Boolean(errors("product_name"))}
                aria-describedby={`${idPrefix}-product-name-help`}
                onChange={(event) => setValues((current) => ({ ...current, product_name: event.target.value }))}
              />
              <FieldDescription id={`${idPrefix}-product-name-help`}>
                Shown instead of {platformName} on the sign-in page, in the browser tab and in the app. The brand shows once it has a name.
              </FieldDescription>
              <FieldError errors={errors("product_name")} />
            </Field>
            <Field data-invalid={Boolean(errors("short_name"))}>
              <FieldLabel htmlFor={`${idPrefix}-short-name`}>Short name</FieldLabel>
              <Input
                id={`${idPrefix}-short-name`}
                className="max-w-48"
                value={values.short_name}
                maxLength={12}
                placeholder={values.product_name.trim().slice(0, 12).trim()}
                disabled={disabled || saving}
                aria-invalid={Boolean(errors("short_name"))}
                aria-describedby={`${idPrefix}-short-name-help`}
                onChange={(event) => setValues((current) => ({ ...current, short_name: event.target.value }))}
              />
              <FieldDescription id={`${idPrefix}-short-name-help`}>
                Under the icon of the installed app, up to 12 characters. Empty uses the start of the product name.
              </FieldDescription>
              <FieldError errors={errors("short_name")} />
            </Field>
            <Field data-invalid={Boolean(errors("support_url"))}>
              <FieldLabel htmlFor={`${idPrefix}-support-url`}>Support link</FieldLabel>
              <Input
                id={`${idPrefix}-support-url`}
                type="url"
                inputMode="url"
                value={values.support_url}
                maxLength={2048}
                placeholder="https://support.example.com"
                disabled={disabled || saving}
                aria-invalid={Boolean(errors("support_url"))}
                aria-describedby={`${idPrefix}-support-url-help`}
                onChange={(event) => setValues((current) => ({ ...current, support_url: event.target.value }))}
              />
              <FieldDescription id={`${idPrefix}-support-url-help`}>Where people get help: an https:// address or a mailto: link.</FieldDescription>
              <FieldError errors={errors("support_url")} />
            </Field>
            {failure && (failure.conflict || !failure.fields) ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>{failure.conflict ? "The brand was changed by someone else" : "Could not save the brand"}</AlertTitle>
                <AlertDescription>
                  {failure.conflict ? "Reload to see the latest version. Your unsaved names and link will be replaced." : failure.message}
                  {failure.conflict ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 self-start"
                      onClick={() => {
                        reloaded.current = true
                        onReload()
                      }}
                    >
                      Reload
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={disabled || saving || !dirty}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {dirty && !saving ? (
                <Button type="button" variant="ghost" onClick={() => { setValues(saved); setFailure(null) }}>
                  Discard
                </Button>
              ) : null}
            </div>
          </FieldGroup>
        </form>
        <FieldGroup>
          {image("logo", "Logo", "Shown on the sign-in page and in the sidebar, scaled to fit 480 × 160 pixels.")}
          {image("logo_dark", "Logo for dark appearance", "Optional. Without it, the logo is shown on dark appearance too.", { surface: "dark" })}
          {image("icon", "Icon", `The browser tab and installed app icon: square, at least ${limits.icon_min} × ${limits.icon_min} pixels.`, { shape: "square" })}
        </FieldGroup>
      </div>
      <figure className="flex min-w-0 flex-col gap-2 self-start">
        <figcaption className="text-meta text-muted-foreground">Preview of the sign-in page</figcaption>
        <div className="flex flex-col gap-4 rounded-lg border bg-sunken p-4">
          <div className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-meta">
            {brand.icon ? (
              <img src={brand.icon.url} alt="" className="size-4 shrink-0 rounded-xs" />
            ) : (
              <span aria-hidden="true" className="size-4 shrink-0 rounded-xs bg-muted" />
            )}
            <span className="truncate">{name}</span>
          </div>
          <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-4 py-6 text-center shadow-panel">
            <BrandMark name={name} logo={brand.logo} logoDark={brand.logo_dark} size="lg" />
            <p className="text-heading">Sign in to {name}</p>
            <div aria-hidden="true" className="flex w-full flex-col gap-2">
              <span className="h-8 rounded-md border bg-background" />
              <span className="h-8 rounded-md border bg-background" />
              <span className="h-8 rounded-md bg-primary" />
            </div>
            <p className="text-meta text-muted-foreground">Powered by {platformName}</p>
          </div>
        </div>
      </figure>
    </div>
  )
}
