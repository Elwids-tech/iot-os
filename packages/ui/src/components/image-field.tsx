import * as React from "react"
import { ImageIcon } from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@iot-os/ui/components/field"
import { cn } from "@iot-os/ui/lib/utils"

const typeNames: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP" }

/** "PNG, JPEG or WebP", from content types. */
export function imageTypeList(types: string[]) {
  const names = types.map((type) => typeNames[type] ?? type)
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : (names[0] ?? "")
}

/** "1 MB", "512 KB". */
export function imageSize(bytes: number) {
  const megabytes = bytes / 1048576
  return megabytes >= 1 ? `${Number(megabytes.toFixed(1))} MB` : `${Math.round(bytes / 1024)} KB`
}

/**
 * One image of a form: a preview, a button to pick or replace it and one to remove it.
 * It names the accepted types and size, refuses a file that breaks them before anything is
 * sent, and shows the reason the server gave when it refuses one (`error`). The image is
 * saved by `onSelect` at once, not with the rest of a form.
 */
export function ImageField({
  id,
  label,
  description,
  value,
  accept,
  maxBytes,
  shape = "wide",
  surface = "page",
  busy = false,
  disabled = false,
  error,
  onSelect,
  onRemove,
  className,
}: {
  id: string
  label: string
  /** What the image is for; the accepted types and size follow it. */
  description?: string
  value: { url: string; width?: number; height?: number } | null
  /** Content types, such as `image/png`. */
  accept: string[]
  maxBytes: number
  shape?: "wide" | "square"
  /** `dark` previews the image on the dark surface it will be shown on. */
  surface?: "page" | "dark"
  busy?: boolean
  disabled?: boolean
  /** Why the server refused the last file. */
  error?: string | null
  onSelect: (file: File) => void
  onRemove?: () => void
  className?: string
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [refused, setRefused] = React.useState<string | null>(null)
  const message = refused ?? error ?? null
  const limits = `${imageTypeList(accept)}, up to ${imageSize(maxBytes)}.`

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // The same file can be picked again after a refusal.
    event.target.value = ""
    if (!file) return
    if (!accept.includes(file.type)) return setRefused(`Choose a ${imageTypeList(accept)} image.`)
    if (file.size > maxBytes) return setRefused(`The image is larger than ${imageSize(maxBytes)}.`)
    setRefused(null)
    onSelect(file)
  }

  return (
    <Field data-slot="image-field" data-invalid={Boolean(message)} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden rounded-md border text-muted-foreground",
            shape === "square" ? "size-16" : "h-16 w-44 px-3",
            surface === "dark" ? "dark bg-background" : "bg-sunken",
          )}
        >
          {value ? (
            <img src={value.url} alt={`Current ${label.toLowerCase()}`} className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageIcon aria-hidden="true" className="size-5" />
          )}
        </div>
        {/* An invalid field colours its text; the buttons keep their own. */}
        <div className="flex flex-wrap items-center gap-2 text-foreground">
          <input
            ref={input}
            id={id}
            type="file"
            accept={accept.join(",")}
            className="sr-only"
            disabled={disabled || busy}
            aria-describedby={`${id}-help`}
            aria-invalid={Boolean(message)}
            onChange={pick}
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </Button>
          {value && onRemove ? (
            <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={onRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <FieldDescription id={`${id}-help`}>{description ? `${description} ${limits}` : limits}</FieldDescription>
      <FieldError errors={message ? [{ message }] : undefined} />
    </Field>
  )
}
