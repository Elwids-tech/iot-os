import { Pager as KitPager } from "@iot-os/ui/components/pager"
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@iot-os/ui/components/sheet"
import { keepToastsAbove } from "@iot-os/ui/components/sonner"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@iot-os/ui/components/alert-dialog"
import {
  CheckIcon,
  CircleAlertIcon,
  CloudOffIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react"
import { cn } from "@iot-os/ui/lib/utils"

/** The device runtime didn't answer; RuntimeStatusBanner already explains the outage page-wide. */
export function isRuntimeUnavailable(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 503) return false
  const message = (error.payload as { message?: string } | null)?.message ?? ""
  return /device runtime/i.test(message)
}
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
    if (error.status === 404 && (!payload?.message || payload.message === "Not Found"))
      return "This isn't available. It may have been removed, or the feature isn't enabled for this organization."
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
/**
 * A query that failed to load: says what could not load and offers a retry.
 * RequestError stays for mutations ("Action needs attention").
 */
export function LoadError({
  error,
  what = "this page",
  onRetry,
  busy,
}: {
  error: unknown
  what?: string
  onRetry?: () => unknown
  busy?: boolean
}) {
  if (!error) return null
  if (isRuntimeUnavailable(error))
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <CloudOffIcon className="size-4 shrink-0" aria-hidden="true" />
        <span>Live data is unavailable right now.</span>
      </div>
    )
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Could not load {what}</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(error)}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => void onRetry()}>
            <RefreshCwIcon data-icon="inline-start" className={cn(busy && "animate-spin")} aria-hidden="true" />
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
export function RequestError({
  error,
  children,
}: {
  error: unknown
  children?: ReactNode
}) {
  if (!error) return null
  // Outages are explained once by the page banner; repeating a red alert per panel is noise.
  if (isRuntimeUnavailable(error))
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <CloudOffIcon className="size-4 shrink-0" aria-hidden="true" />
        <span>Live data is unavailable right now.</span>
        {children}
      </div>
    )
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
// The labelled fields live in the shared form kit; these names stay for existing callers.
export { TextField, SelectField as Choice } from "@iot-os/ui/components/form-fields"
/** Set by EditorSheet: asks "Discard unsaved changes?" before running `close`. */
const SheetDiscard = createContext<((close: () => void) => void) | null>(null)
/** True for two seconds after `busy` falls while the form is clean: the save landed. */
function useJustSaved(dirty: boolean, busy: boolean) {
  const [saved, setSaved] = useState(false)
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy && !dirty) setSaved(true)
    wasBusy.current = busy
  }, [busy, dirty])
  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 2000)
    return () => window.clearTimeout(timer)
  }, [saved])
  return saved && !dirty
}
export function SaveBar({
  dirty,
  busy,
  disabled,
  suggested,
  onCancel,
  label = "Save changes",
}: {
  dirty: boolean
  busy: boolean
  disabled?: boolean
  /** Saving is allowed without changes: the form holds suggested values that were never saved. */
  suggested?: boolean
  onCancel: () => void
  label?: string
}) {
  // Inside an EditorSheet, Cancel uses the same discard guard as closing the sheet (N7).
  const discard = useContext(SheetDiscard)
  const saved = useJustSaved(dirty, busy)
  return (
    <div
      ref={keepToastsAbove}
      className="sticky bottom-0 flex w-full flex-wrap items-center justify-between gap-3 border-t bg-card px-6 py-4"
    >
      <span
        className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", saved && "text-success")}
        role="status"
      >
        {saved && <CheckIcon className="size-3.5" aria-hidden="true" />}
        {busy
          ? "Saving…"
          : dirty
            ? "Unsaved changes"
            : saved
              ? "Saved"
              : suggested
                ? "Suggested values, not saved yet"
                : "No unsaved changes"}
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
        <Button type="submit" disabled={!(dirty || suggested) || busy || disabled}>
          {busy && <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden="true" />}
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
/** Adapter over the kit Pager for forms that page their own lists. */
export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number
  pages: number
  onPage: (page: number) => void
}) {
  return <KitPager page={page} pageCount={Math.max(1, pages)} onPageChange={onPage} />
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
