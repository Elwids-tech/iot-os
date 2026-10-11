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
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatDateTime } from "@iot-os/ui/lib/format"
import { AlertCircleIcon, MailIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

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

  const columns: DataColumn<OrganizationInvitation>[] = [
    { id: "email", header: "Email", mobile: "title", value: (i) => i.email, cell: (i) => <span className="font-medium">{i.email}</span> },
    { id: "organization", header: "Organization", value: (i) => i.organization.name, cell: (i) => i.organization.name },
    {
      id: "roles",
      header: "Roles",
      className: "min-w-40 whitespace-normal",
      value: (i) => i.roles.map((role) => role.display_name).join(", "),
      cell: (i) => i.roles.map((role) => role.display_name).join(", "),
    },
    {
      id: "expires",
      header: "Expires",
      mobile: "hidden",
      value: (i) => i.expires_at,
      cell: (i) => <span className="text-muted-foreground tabular-nums">{formatDateTime(i.expires_at)}</span>,
    },
    { id: "status", header: "Status", mobile: "badge", value: (i) => i.status, cell: (i) => <Status value={i.status} /> },
  ]

  return (
    <section aria-labelledby="invitations-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="invitations-heading" className="skin-label text-heading">
        Invitations
      </h2>
      <DataTable
        id="admin-invitations"
        label="Invitations"
        noun={["invitation", "invitations"]}
        rows={state.error ? [] : state.data?.data}
        rowKey={(i) => i.uuid}
        rowLabel={(i) => i.email}
        columns={columns}
        error={
          state.error ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load invitations</AlertTitle>
              <AlertDescription>Refresh the page and try again.</AlertDescription>
            </Alert>
          ) : undefined
        }
        pagination={{
          page,
          pageSize: 25,
          total: state.data?.meta.total ?? 0,
          pageCount: state.data?.meta.last_page,
          onPageChange: setPage,
        }}
        rowActions={(invitation) => {
          const canResend = invitation.status === "pending" || invitation.status === "expired"
          if (!canResend && invitation.status !== "pending") return null
          return (
            <>
              {canResend && (
                <DropdownMenuItem
                  onSelect={() => {
                    setActionError(null)
                    setConfirming({ action: "resend", invitation })
                  }}
                >
                  Resend
                </DropdownMenuItem>
              )}
              {invitation.status === "pending" && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    setActionError(null)
                    setConfirming({ action: "revoke", invitation })
                  }}
                >
                  Revoke
                </DropdownMenuItem>
              )}
            </>
          )
        }}
        empty={<EmptyState inset icon={<MailIcon />} title="No invitations yet" description="Invitations you send appear here." />}
      />
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
