import { useState } from "react"
import type { DirectoryQuery, OrganizationInvitation, PaginatedResponse } from "@iot-os/api-client"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Status } from "@iot-os/ui/components/status-mark"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { formatDateTime } from "@iot-os/ui/lib/format"
import { AlertCircleIcon, MailIcon } from "lucide-react"
import { toast } from "sonner"
import { useDirectoryTable } from "./ResourceDirectory"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

type Confirming = { action: "resend" | "revoke"; invitation: OrganizationInvitation }

const allOrganizations = "All organizations"
const superAdministrator = "Super administrator"

function loadInvitations(query: DirectoryQuery): Promise<PaginatedResponse<OrganizationInvitation>> {
  return apiClient.adminInvitations(query)
}

function organizationName(invitation: OrganizationInvitation): string {
  return invitation.organization?.name ?? allOrganizations
}

function roleNames(invitation: OrganizationInvitation): string {
  return invitation.grants_super_admin ? superAdministrator : invitation.roles.map((role) => role.display_name).join(", ")
}

/** Every invitation, newest first; search and page live in the URL like the other directories. */
export function PendingInvitations({
  managesSuperAdministrators = false,
}: {
  /** Only super administrators resend or revoke super-administrator invitations (spec 007). */
  managesSuperAdministrators?: boolean
}) {
  const url = useUrlState()
  const { reload, table } = useDirectoryTable(loadInvitations, { searchPlaceholder: "Email" })
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
        if (invitation.organization) {
          await apiClient.inviteUser(invitation.organization.uuid, invitation.email, invitation.role_ids)
        } else {
          await apiClient.inviteSuperAdministrator(invitation.email)
        }
        toast.success(`Invitation sent to ${invitation.email}`)
        // The new invitation is the newest, so it heads the first page.
        url.set({ page: null })
      }
      setConfirming(null)
      reload()
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
    {
      id: "organization",
      header: "Organization",
      value: organizationName,
      cell: (i) => (i.organization ? i.organization.name : <span className="text-muted-foreground">{allOrganizations}</span>),
    },
    {
      id: "roles",
      header: "Roles",
      className: "min-w-40 whitespace-normal",
      value: roleNames,
      cell: roleNames,
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
    <>
      <DataTable
        id="admin-invitations"
        label="Invitations"
        noun={["invitation", "invitations"]}
        rowKey={(i) => i.uuid}
        rowLabel={(i) => i.email}
        columns={columns}
        {...table}
        rowActions={(invitation) => {
          if (invitation.grants_super_admin && !managesSuperAdministrators) return null
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
    </>
  )
}
