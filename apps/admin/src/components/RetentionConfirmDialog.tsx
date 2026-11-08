import { ApiError, type RetentionNeedsConfirmation } from "@iot-os/api-client"
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
import { formatDateTime } from "@iot-os/ui/lib/format"

/** The retention confirmation a billing change answered with, or null for any other error (spec 029 US4). */
export function retentionConfirmation(error: unknown): RetentionNeedsConfirmation | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const payload = error.payload as Partial<RetentionNeedsConfirmation> | null
  return payload?.retention ? (payload as RetentionNeedsConfirmation) : null
}

/**
 * Asks before a billing change shortens organizations' telemetry retention: it names each
 * organization and the date older history starts to be deleted, 30 days away. Confirming
 * resends the change with `confirm_retention`.
 */
export function RetentionConfirmDialog({
  confirmation,
  busy,
  onConfirm,
  onCancel,
}: {
  confirmation: RetentionNeedsConfirmation | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const organizations = confirmation?.retention.organizations ?? []

  return (
    <AlertDialog open={confirmation !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Shorten telemetry retention for {organizations.length}{" "}
            {organizations.length === 1 ? "organization" : "organizations"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            From {confirmation ? formatDateTime(confirmation.retention.deletion_from) : ""}, history older than the
            new period is deleted and cannot be restored. Until then cleanup keeps the current period, and changing it
            back before that date deletes nothing. Owners are emailed now and a week before.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1 text-body">
          {organizations.map((organization) => (
            <li key={organization.uuid} className="flex justify-between gap-4">
              <span>{organization.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {organization.from_days} → {organization.to_days} {organization.to_days === 1 ? "day" : "days"}
              </span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Saving…" : "Shorten retention"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
