import { useEffect, useState } from "react"
import type { OrganizationInvitation, PaginatedResponse } from "@iot-os/api-client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@iot-os/ui/components/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iot-os/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@iot-os/ui/components/empty"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table"
import { AlertCircleIcon, MailIcon } from "lucide-react"
import { apiClient } from "../lib/api-client"

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

type InvitationState = {
  data?: PaginatedResponse<OrganizationInvitation>
  error: boolean
}

export function PendingInvitations({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<InvitationState>({ error: false })
  const [revokingUuid, setRevokingUuid] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState(false)

  useEffect(() => {
    let active = true
    setState({ error: false })
    setRevokeError(false)

    apiClient
      .adminInvitations({ perPage: 100 })
      .then((data) => {
        if (active) setState({ data, error: false })
      })
      .catch(() => {
        if (active) setState({ error: true })
      })

    return () => {
      active = false
    }
  }, [refreshKey])

  async function revoke(invitationUuid: string) {
    setRevokingUuid(invitationUuid)
    setRevokeError(false)

    try {
      await apiClient.revokeAdminInvitation(invitationUuid)
      setState((current) =>
        current.data
          ? {
              ...current,
              data: {
                ...current.data,
                data: current.data.data.map((invitation) =>
                  invitation.uuid === invitationUuid
                    ? { ...invitation, revoked_at: new Date().toISOString(), status: "revoked" }
                    : invitation,
                ),
              },
            }
          : current,
      )
    } catch {
      setRevokeError(true)
    } finally {
      setRevokingUuid(null)
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>Track pending, accepted, revoked, and expired organization invitations.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        {revokeError ? (
          <div className="px-4 pb-4">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not revoke invitation</AlertTitle>
              <AlertDescription>Try again before sending a replacement invitation.</AlertDescription>
            </Alert>
          </div>
        ) : null}
        {state.error ? (
          <div className="px-4 pb-4">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load invitations</AlertTitle>
              <AlertDescription>Refresh the page and try again.</AlertDescription>
            </Alert>
          </div>
        ) : !state.data ? (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : state.data.data.length === 0 ? (
          <Empty className="min-h-48 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailIcon />
              </EmptyMedia>
              <EmptyTitle>No invitations yet</EmptyTitle>
              <EmptyDescription>Invite a user to grant organization access.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.data.map((invitation) => (
                <TableRow key={invitation.uuid}>
                  <TableCell className="break-words font-medium">{invitation.email}</TableCell>
                  <TableCell>{invitation.organization.name}</TableCell>
                  <TableCell>
                    <div className="flex min-w-40 flex-wrap gap-1">
                      {invitation.roles.map((role) => (
                        <Badge key={role.id} variant="outline">{role.display_name}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dateTime.format(new Date(invitation.expires_at))}
                  </TableCell>
                  <TableCell><Badge variant={invitation.status === "pending" ? "secondary" : "outline"}>{invitation.status}</Badge></TableCell>
                  <TableCell>
                    {invitation.status === "pending" ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" disabled={revokingUuid === invitation.uuid}>
                            Revoke
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {invitation.email} will no longer be able to accept this invitation.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => void revoke(invitation.uuid)}>
                              Revoke invitation
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
