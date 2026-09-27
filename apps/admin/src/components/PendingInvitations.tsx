import { useEffect, useState } from "react"
import type { OrganizationInvitation, PaginatedResponse } from "@iot-os/api-client"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { formatDateTime } from "@iot-os/ui/lib/format"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"
import { countLabel } from "./DirectoryStates"
import { PaginationControls } from "./PaginationControls"

const statuses: Record<OrganizationInvitation["status"], { tone: StatusTone; label: string }> = {
  pending: { tone: "info", label: "Pending" },
  accepted: { tone: "good", label: "Accepted" },
  revoked: { tone: "muted", label: "Revoked" },
  expired: { tone: "warning", label: "Expired" },
}

type InvitationState = {
  data?: PaginatedResponse<OrganizationInvitation>
  error: boolean
}

type Confirming = { action: "resend" | "revoke"; invitation: OrganizationInvitation }

export function PendingInvitations({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<InvitationState>({ error: false })
  const [page, setPage] = useState(1)
  const [version, setVersion] = useState(0)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => setPage(1), [refreshKey])

  useEffect(() => {
    let active = true
    setState((current) => ({ data: current.data, error: false }))

    apiClient
      .adminInvitations({ page, perPage: 25 })
      .then((data) => {
        if (active) setState({ data, error: false })
      })
      .catch(() => {
        if (active) setState({ error: true })
      })

    return () => {
      active = false
    }
  }, [page, refreshKey, version])

  // Resend re-invites with the same roles; the API revokes the earlier pending link and emails a new one.
  async function confirm() {
    if (!confirming) return
    const { action, invitation } = confirming
    setBusy(true)
    setActionError(null)

    try {
      if (action === "revoke") {
        await apiClient.revokeAdminInvitation(invitation.uuid)
        toast.success(`Invitation for ${invitation.email} revoked`)
      } else {
        await apiClient.inviteUser(invitation.organization.uuid, invitation.email, invitation.role_ids)
        toast.success(`Invitation sent to ${invitation.email}`)
        setPage(1)
      }
      setConfirming(null)
      setVersion((current) => current + 1)
    } catch (error) {
      const fields = validationErrors(error)
      setActionError(
        fieldMessages(fields, "email")?.[0] ?? fieldMessages(fields, "role_ids")?.[0] ?? errorMessage(error),
      )
    } finally {
      setBusy(false)
    }
  }

  const invitations = state.data?.data

  return (
    <section aria-labelledby="invitations-heading" className="min-w-0">
      <div className="mb-2 flex items-center gap-3">
        <h2 id="invitations-heading" className="text-sm font-semibold">
          Invitations
        </h2>
        {state.data ? (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {countLabel(state.data.meta.total, "invitation", "invitations")}
          </span>
        ) : null}
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Could not load invitations</AlertTitle>
          <AlertDescription>Refresh the page and try again.</AlertDescription>
        </Alert>
      ) : !invitations ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : invitations.length === 0 ? (
        <p className="border-t py-4 text-sm text-muted-foreground">No invitations yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => {
              const status = statuses[invitation.status]
              const canResend = invitation.status === "pending" || invitation.status === "expired"

              return (
                <TableRow key={invitation.uuid}>
                  <TableCell className="font-medium">{invitation.email}</TableCell>
                  <TableCell>{invitation.organization.name}</TableCell>
                  <TableCell className="min-w-40 whitespace-normal">
                    {invitation.roles.map((role) => role.display_name).join(", ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDateTime(invitation.expires_at)}
                  </TableCell>
                  <TableCell>
                    <StatusMark tone={status.tone}>{status.label}</StatusMark>
                  </TableCell>
                  <TableCell className="w-0 text-right">
                    <div className="flex justify-end gap-1">
                      {canResend ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActionError(null)
                            setConfirming({ action: "resend", invitation })
                          }}
                        >
                          Resend
                        </Button>
                      ) : null}
                      {invitation.status === "pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setActionError(null)
                            setConfirming({ action: "revoke", invitation })
                          }}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {state.data ? (
        <PaginationControls meta={state.data.meta} label="Invitations pages" onPage={setPage} />
      ) : null}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.action === "revoke" ? "Revoke invitation?" : "Resend invitation?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.action === "revoke"
                ? `${confirming.invitation.email} will no longer be able to accept this invitation.`
                : `${confirming?.invitation.email} gets a new link. Any earlier link stops working.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant={confirming?.action === "revoke" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {confirming?.action === "revoke"
                ? busy
                  ? "Revoking…"
                  : "Revoke invitation"
                : busy
                  ? "Sending…"
                  : "Resend invitation"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
