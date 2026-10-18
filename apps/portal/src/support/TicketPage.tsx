import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleCheckIcon, LogOutIcon, PencilIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { Ticket } from "@iot-os/api-client"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { Composer, type ComposerFile } from "@iot-os/ui/components/composer"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { TextField } from "@iot-os/ui/components/form-fields"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { TicketThread, ticketTypeLabels } from "@iot-os/ui/components/ticket-thread"
import { EntityPage, PropertyList } from "@iot-os/ui/templates/entity-page"
import { Confirm, LoadError, RequestError, fieldError } from "../components/forms"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { clientId, newTicketPath, supportPath } from "./model"

/** One ticket for its reporter and the people they tagged (spec 015 US3, US4). */
export function TicketPage() {
  const params = useParams()
  const org = params.organizationUuid!
  const uuid = params.ticketUuid!
  const cache = useQueryClient()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ["ticket", org, uuid],
    queryFn: () => api.ticket(org, uuid),
    refetchInterval: 30_000,
  })
  const ticket = query.data
  const session = useQuery({ queryKey: ["session"], queryFn: () => api.me(), staleTime: 60000 })
  const [closing, setClosing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [renaming, setRenaming] = useState(false)

  // Opening the ticket reads it up to what the page shows; later activity stays unread.
  const sequence = ticket?.sequence
  useEffect(() => {
    if (sequence === undefined) return
    const read = () => {
      if (document.visibilityState !== "visible") return
      void api
        .markTicketRead(org, uuid, sequence)
        .then(() => cache.invalidateQueries({ queryKey: ["support-summary", org] }))
        .catch(() => undefined)
    }
    read()
    document.addEventListener("visibilitychange", read)
    return () => document.removeEventListener("visibilitychange", read)
  }, [cache, org, uuid, sequence])

  const refresh = (next: Ticket) => {
    cache.setQueryData(["ticket", org, uuid], next)
    void cache.invalidateQueries({ queryKey: ["tickets", org] })
  }

  if (!ticket)
    return (
      <EntityPage title="Ticket" back={{ to: supportPath(org), label: "Support" }}>
        {query.error ? (
          <LoadError error={query.error} what="this ticket" onRetry={() => query.refetch()} busy={query.isFetching} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </EntityPage>
    )

  return (
    <EntityPage
      title={ticket.title}
      code={`#${ticket.number}`}
      back={{ to: supportPath(org), label: "Support" }}
      status={
        <>
          <Status value={ticket.status} domain="ticket" />
          <span className="text-muted-foreground">{ticketTypeLabels[ticket.type]}</span>
          <span className="text-muted-foreground">
            Filed <RelativeTime at={ticket.created_at} />
          </span>
        </>
      }
      actions={
        <>
          {ticket.abilities.edit_title && (
            <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
              <PencilIcon data-icon="inline-start" />
              Rename
            </Button>
          )}
          {ticket.abilities.close && (
            <Button variant="outline" size="sm" onClick={() => setClosing(true)}>
              <CircleCheckIcon data-icon="inline-start" />
              Close as resolved
            </Button>
          )}
        </>
      }
      rail={
        <>
          <People ticket={ticket} org={org} onChange={refresh} onLeave={() => setLeaving(true)} />
          <Panel>
            <PanelHeader>
              <PanelTitle>Details</PanelTitle>
            </PanelHeader>
            <PanelContent>
              <PropertyList
                items={[
                  { label: "Ticket", value: <span className="font-mono">#{ticket.number}</span> },
                  { label: "Type", value: ticketTypeLabels[ticket.type] },
                  { label: "Organization", value: ticket.organization?.name ?? "Deleted organization" },
                  { label: "Last activity", value: <RelativeTime at={ticket.last_activity_at} /> },
                  { label: "Page", value: <span className="font-mono text-code break-all">{ticket.context.path ?? "Not recorded"}</span> },
                  { label: "Browser", value: <span className="break-all">{ticket.context.user_agent ?? "Not recorded"}</span> },
                  { label: "Screen", value: ticket.context.screen ?? "Not recorded" },
                  { label: "Time zone", value: ticket.context.time_zone ?? "Not recorded" },
                ]}
              />
            </PanelContent>
          </Panel>
        </>
      }
    >
      <Panel>
        <PanelContent className="flex flex-col gap-4">
          <TicketThread items={ticket.timeline} fileHref={(attachment) => api.ticketAttachmentUrl(org, uuid, attachment)} />
          {ticket.abilities.reply ? (
            <Reply ticket={ticket} org={org} onSent={refresh} />
          ) : (
            <Alert>
              <AlertTitle>This ticket was declined</AlertTitle>
              <AlertDescription>It takes no more replies. File a new ticket if something has changed.</AlertDescription>
              <AlertAction>
                <Button variant="outline" size="sm" asChild>
                  <Link to={newTicketPath(org, ticket.type)}>New ticket</Link>
                </Button>
              </AlertAction>
            </Alert>
          )}
        </PanelContent>
      </Panel>
      <Confirm
        open={closing}
        title="Close this ticket as resolved?"
        description="The platform team sees that you closed it. Reply later to reopen it."
        action="Close as resolved"
        destructive={false}
        onClose={() => setClosing(false)}
        onConfirm={async () => refresh(await api.updateTicket(org, uuid, { status: "resolved" }))}
      />
      <Confirm
        open={leaving}
        title="Leave this ticket?"
        description="You stop seeing it and its emails. The reporter can tag you again."
        action="Leave ticket"
        onClose={() => setLeaving(false)}
        onConfirm={async () => {
          if (!session.data) return
          await api.removeTicketParticipant(org, uuid, session.data.id)
          await cache.invalidateQueries({ queryKey: ["tickets", org] })
          toast.success(`You left ticket #${ticket.number}.`)
          navigate(supportPath(org), { replace: true })
        }}
      />
      <Rename ticket={ticket} org={org} open={renaming} onOpenChange={setRenaming} onSaved={refresh} />
    </EntityPage>
  )
}

function Reply({ ticket, org, onSent }: { ticket: Ticket; org: string; onSent: (ticket: Ticket) => void }) {
  const [body, setBody] = useState("")
  const [files, setFiles] = useState<ComposerFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const attempt = useRef<{ id: string; signature: string } | null>(null)
  useUnsaved(body.trim() !== "" || files.length > 0)

  async function send() {
    const valid = files.filter((entry) => !entry.error).map((entry) => entry.file)
    const signature = JSON.stringify([body, valid.map((file) => [file.name, file.size])])
    if (attempt.current?.signature !== signature) attempt.current = { id: clientId(), signature }
    setBusy(true)
    setError(undefined)
    try {
      onSent(await api.replyToTicket(org, ticket.uuid, { client_id: attempt.current.id, body }, valid))
      setBody("")
      setFiles([])
      attempt.current = null
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  const reopens = ticket.status === "resolved"
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <Composer
        label="Reply"
        placeholder={ticket.status === "needs_info" ? "Answer the platform team's question…" : "Write a reply…"}
        value={body}
        onValueChange={setBody}
        files={files}
        onFilesChange={setFiles}
        onSubmit={() => void send()}
        pending={busy}
        submitLabel={reopens ? "Reply and reopen" : "Reply"}
        invalid={Boolean(fieldError(error, "body"))}
      />
      <RequestError error={error} />
    </div>
  )
}

function People({
  ticket,
  org,
  onChange,
  onLeave,
}: {
  ticket: Ticket
  org: string
  onChange: (ticket: Ticket) => void
  onLeave: () => void
}) {
  const [search, setSearch] = useState("")
  const [error, setError] = useState<unknown>()
  const candidates = useQuery({
    queryKey: ["ticket-people", org, ticket.uuid, search],
    queryFn: () => api.ticketPeople(org, ticket.uuid, search),
    enabled: ticket.abilities.manage_people,
  })
  const full = ticket.people.length > 10

  async function act(action: () => Promise<Ticket | null>) {
    setError(undefined)
    try {
      const next = await action()
      if (next) onChange(next)
    } catch (caught) {
      setError(caught)
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>People</PanelTitle>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {ticket.people.map((person) => (
            <li key={person.id} className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body">{person.name}</p>
                <p className="truncate text-meta text-muted-foreground">
                  {person.role === "reporter" ? "Reporter" : "Tagged"} · {person.email}
                </p>
              </div>
              {ticket.abilities.manage_people && person.role === "participant" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${person.name}`}
                  onClick={() =>
                    void act(async () => {
                      await api.removeTicketParticipant(org, ticket.uuid, person.id)
                      return api.ticket(org, ticket.uuid)
                    })
                  }
                >
                  <XIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {ticket.abilities.manage_people && (
          <SearchableSelect
            label="Tag a colleague"
            value=""
            options={(candidates.data ?? []).map((person) => ({ value: String(person.id), label: `${person.name} · ${person.email}` }))}
            onChange={(value) => value && void act(() => api.addTicketParticipant(org, ticket.uuid, Number(value)))}
            search={search}
            onSearchChange={setSearch}
            loading={candidates.isFetching}
            disabled={full}
            placeholder={full ? "10 people tagged" : "Search people in this organization"}
            emptyText="No one else in this organization matches."
            help="Tagged people can read and reply, and get its emails."
          />
        )}
        {ticket.abilities.leave && (
          <Button variant="outline" size="sm" className="self-start" onClick={onLeave}>
            <LogOutIcon data-icon="inline-start" />
            Leave ticket
          </Button>
        )}
        <RequestError error={error} />
      </PanelContent>
    </Panel>
  )
}

function Rename({
  ticket,
  org,
  open,
  onOpenChange,
  onSaved,
}: {
  ticket: Ticket
  org: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (ticket: Ticket) => void
}) {
  const [title, setTitle] = useState(ticket.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  useEffect(() => {
    if (open) {
      setTitle(ticket.title)
      setError(undefined)
    }
  }, [open, ticket.title])
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError(undefined)
            try {
              onSaved(await api.updateTicket(org, ticket.uuid, { title }))
              onOpenChange(false)
            } catch (caught) {
              setError(caught)
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename ticket #{ticket.number}</DialogTitle>
          </DialogHeader>
          <TextField label="Title" value={title} maxLength={150} autoFocus error={fieldError(error, "title")} onChange={(event) => setTitle(event.target.value)} />
          {!fieldError(error, "title") && <RequestError error={error} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || title.trim().length < 3 || title.trim() === ticket.title}>
              {busy ? "Saving…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
