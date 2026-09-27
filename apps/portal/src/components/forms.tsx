import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import { ApiError } from "@iot-os/api-client"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@iot-os/ui/components/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@iot-os/ui/components/sheet"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@iot-os/ui/components/alert-dialog"
import { CircleAlertIcon } from "lucide-react"
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const payload = error.payload as {
      message?: string
      errors?: Record<string, string[]>
      references?: Array<{ label: string }>
    } | null
    if (error.status === 409)
      return "Another change was saved while you were editing. Your form has been kept. Review the latest draft before retrying."
    if (error.status === 401)
      return "Your session expired. Sign in again to continue."
    if (error.status === 403)
      return "You do not have permission for this action in this organization."
    return (
      [
        payload?.message,
        ...Object.values(payload?.errors ?? {}).flat(),
        ...(payload?.references ?? []).map((item) => item.label),
      ]
        .filter(Boolean)
        .join(" ") || "The request could not be completed."
    )
  }
  return error instanceof Error
    ? error.message
    : "Unable to reach the API. Check your connection and try again."
}
export function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  const payload = error.payload as { errors?: Record<string, string[]> } | null
  return payload?.errors?.[field]?.join(" ")
}
export function RequestError({
  error,
  children,
}: {
  error: unknown
  children?: ReactNode
}) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Action needs attention</AlertTitle>
      <AlertDescription>
        {errorMessage(error)}
        {children}
      </AlertDescription>
    </Alert>
  )
}
export function TextField({
  label,
  help,
  error,
  ...props
}: ComponentProps<typeof Input> & {
  label: string
  help?: string
  error?: string
}) {
  const generated = useId()
  const id = props.id ?? generated
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...props}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={
          [help && id + "-help", error && id + "-error"]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {help && <FieldDescription id={id + "-help"}>{help}</FieldDescription>}
      {error && <FieldError id={id + "-error"}>{error}</FieldError>}
    </Field>
  )
}
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
  help,
  error,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  disabled?: boolean
  help?: string
  error?: string
}) {
  const id = useId()
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value || "__none"}
        onValueChange={(next) => onChange(next === "__none" ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={Boolean(error)}
          aria-describedby={
            [help && id + "-help", error && id + "-error"]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value || "__none"}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {help && <FieldDescription id={id + "-help"}>{help}</FieldDescription>}
      {error && <FieldError id={id + "-error"}>{error}</FieldError>}
    </Field>
  )
}
/** Set by EditorSheet: asks "Discard unsaved changes?" before running `close`. */
const SheetDiscard = createContext<((close: () => void) => void) | null>(null)
export function SaveBar({
  dirty,
  busy,
  disabled,
  onCancel,
  label = "Save changes",
}: {
  dirty: boolean
  busy: boolean
  disabled?: boolean
  onCancel: () => void
  label?: string
}) {
  // Inside an EditorSheet, Cancel uses the same discard guard as closing the sheet (N7).
  const discard = useContext(SheetDiscard)
  return (
    <div className="sticky bottom-0 flex w-full flex-wrap items-center justify-between gap-3 border-t bg-card px-6 py-4">
      <span className="text-xs text-muted-foreground" role="status">
        {busy ? "Saving…" : dirty ? "Unsaved changes" : "No unsaved changes"}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => (dirty && discard ? discard(onCancel) : onCancel())}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!dirty || busy || disabled}>
          {busy ? "Saving…" : label}
        </Button>
      </div>
    </div>
  )
}
export function Confirm({
  open,
  title,
  description,
  action = "Delete",
  onClose,
  onConfirm,
  destructive = true,
  onRefresh,
}: {
  open: boolean
  title: string
  description: string
  action?: string
  onClose: () => void
  onConfirm: () => Promise<unknown> | void
  destructive?: boolean
  onRefresh?: () => Promise<unknown>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          setError(null)
          onClose()
        }
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
        }}
        onCloseAutoFocus={(event) => {
          if (
            returnFocus.current?.isConnected &&
            !returnFocus.current.matches(":disabled")
          ) {
            event.preventDefault()
            returnFocus.current.focus()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <RequestError error={error} />
        {error instanceof ApiError && error.status === 409 && onRefresh && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onRefresh()
                setError(null)
                onClose()
              } catch (reason) {
                setError(reason)
              } finally {
                setBusy(false)
              }
            }}
          >
            Reload latest draft
          </Button>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
                onClose()
              } catch (reason) {
                setError(reason)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? "Working…" : action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
export function EditorSheet({
  title,
  description,
  dirty,
  busy,
  onClose,
  children,
}: {
  title: string
  description: string
  dirty: boolean
  busy?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const [discard, setDiscard] = useState<(() => void) | null>(null)
  useEffect(() => {
    toast.dismiss()
  }, [])
  return (
    <SheetDiscard.Provider value={(close) => setDiscard(() => close)}>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open && !busy) dirty ? setDiscard(() => onClose) : onClose()
        }}
      >
        <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
      <Confirm
        open={Boolean(discard)}
        title="Discard unsaved changes?"
        description="Your saved draft will not change."
        action="Discard changes"
        onClose={() => setDiscard(null)}
        onConfirm={() => discard?.()}
      />
    </SheetDiscard.Provider>
  )
}
/** "Page N of M" with Previous and Next; the one pager for directory and detail tables (P6). */
export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number
  pages: number
  onPage: (page: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="mr-auto tabular-nums">
        Page {page} of {Math.max(1, pages)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  )
}
export function parseObject(value: string, nullable = true) {
  const parsed: unknown = JSON.parse(value)
  if (nullable && parsed === null) return null
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(
      "Configuration must be a JSON object" + (nullable ? " or null." : "."),
    )
  return parsed as import("@iot-os/api-client").JsonObject
}
