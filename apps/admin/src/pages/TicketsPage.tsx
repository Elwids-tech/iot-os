import { useEffect, useMemo, useRef, useState } from "react"
import {
  ApiError,
  ticketPriorities,
  ticketStatuses,
  ticketTypes,
  type AdminTicket,
  type AdminTicketChanges,
  type AdminTicketSummary,
  type TicketCandidate,
  type TicketStatus,
} from "@iot-os/api-client"
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
import { Checkbox } from "@iot-os/ui/components/checkbox"
import { Composer, type ComposerFile } from "@iot-os/ui/components/composer"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@iot-os/ui/components/dialog"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Field, FieldLabel } from "@iot-os/ui/components/field"
import { SelectField, TextField } from "@iot-os/ui/components/form-fields"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Input } from "@iot-os/ui/components/input"
import { Pager } from "@iot-os/ui/components/pager"
import {
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status, type StatusTone } from "@iot-os/ui/components/status-mark"
import { TicketThread, ticketTypeLabels } from "@iot-os/ui/components/ticket-thread"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { useWide } from "@iot-os/ui/hooks/use-wide"
import { statusOf } from "@iot-os/ui/lib/status"
import { InboxItem, InboxList, InboxPage } from "@iot-os/ui/templates/inbox-page"
import { PropertyList } from "@iot-os/ui/templates/entity-page"
import { ArrowLeftIcon, InboxIcon, PencilIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useOrganizationOptions } from "../hooks/use-directory"
import { usePolled } from "../hooks/use-polled"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

const FILTERS = ["state", "type", "priority", "organization", "assignee", "awaiting", "search", "page"] as const

/** Stripe colour in the queue: urgent and high priority stand out; tickets awaiting a reply are info. */
function stripe(ticket: AdminTicketSummary): StatusTone {
  if (ticket.priority === "urgent" || ticket.priority === "high") return statusOf(ticket.priority, "priority").tone
  return ticket.awaiting_team ? "info" : "muted"
}

/** A fresh id per submission, so a retried request sends one message. */
function clientId() {
  return crypto.randomUUID()
}

/**
 * The team's support ticket queue (spec 015 US2): open tickets with those awaiting a
 * reply first, and the selected ticket beside them from 1280px.
 */
export function TicketsPage() {
  const { ticketUuid } = useParams()
  const wide = useWide()
  const [params, setParams] = useSearchParams()
  const organizations = useOrganizationOptions()
  const [search, setSearch] = useState(params.get("search") ?? "")
  const assignees = usePolled(() => apiClient.adminTicketAssignees(), "assignees")
  const query = useMemo(() => {
    const next = new URLSearchParams()
    for (const key of FILTERS) {
      const value = params.get(key)
      if (value) next.set(key, value)
    }
    return next
  }, [params])
  const list = usePolled(() => apiClient.adminTickets(query), query.toString(), 30_000)
  const state = params.get("state") ?? "open"
  const page = Number(params.get("page") ?? 1)
  const suffix = params.size ? `?${params}` : ""
  const narrowDetail = Boolean(ticketUuid) && !wide

  function change(key: (typeof FILTERS)[number], value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== "page") next.delete("page")
    setParams(next, { replace: true })
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    if (search === (params.get("search") ?? "")) return
    const timer = window.setTimeout(() => change("search", search.trim() || null), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  // The sidebar's awaiting count listens for this.
  const refreshList = () => {
    void list.reload()
    window.dispatchEvent(new Event("iot-tickets-changed"))
  }
  const filtered = FILTERS.some((key) => key !== "page" && key !== "state" && params.get(key))
  const tickets = list.data?.data
  const people = assignees.data ?? []

  return (
    <InboxPage
      title="Tickets"
      wide={wide}
      showDetail={Boolean(ticketUuid)}
      toolbar={
        <>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            aria-label="Tickets"
            value={state}
            onValueChange={(value) => value && change("state", value === "open" ? null : value)}
          >
            <ToggleGroupItem value="open">Open</ToggleGroupItem>
            <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
          <div className="relative w-56">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search tickets"
              placeholder="Search titles or #number"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="w-40">
            <SelectField
              label="Type"
              labelHidden
              value={params.get("type") ?? ""}
              options={[{ value: "", label: "Any type" }, ...ticketTypes]}
              onChange={(value) => change("type", value || null)}
            />
          </div>
          <div className="w-36">
            <SelectField
              label="Priority"
              labelHidden
              value={params.get("priority") ?? ""}
              options={[{ value: "", label: "Any priority" }, ...ticketPriorities.map((value) => ({ value, label: statusOf(value, "priority").label }))]}
              onChange={(value) => change("priority", value || null)}
            />
          </div>
          <div className="w-48">
            <SelectField
              label="Organization"
              labelHidden
              value={params.get("organization") ?? ""}
              options={[{ value: "", label: "All organizations" }, ...organizations.map((item) => ({ value: item.uuid, label: item.name }))]}
              onChange={(value) => change("organization", value || null)}
            />
          </div>
          <div className="w-44">
            <SelectField
              label="Assignee"
              labelHidden
              value={params.get("assignee") ?? ""}
              options={[
                { value: "", label: "Anyone" },
                { value: "me", label: "Assigned to me" },
                { value: "none", label: "Unassigned" },
                ...people.map((person) => ({ value: String(person.id), label: person.name })),
              ]}
              onChange={(value) => change("assignee", value || null)}
            />
          </div>
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="tickets-awaiting"
              checked={params.get("awaiting") === "1"}
              onCheckedChange={(checked) => change("awaiting", checked === true ? "1" : null)}
            />
            <FieldLabel htmlFor="tickets-awaiting" className="font-normal">
              Awaiting reply
              {list.data?.meta.awaiting !== undefined && (
                <span className="text-muted-foreground tabular-nums">{list.data.meta.awaiting}</span>
              )}
            </FieldLabel>
          </Field>
        </>
      }
      list={
        <>
          {list.error && !tickets ? (
            <p className="p-4 text-body text-destructive">{errorMessage(list.error)}</p>
          ) : !tickets ? (
            <div className="flex flex-col gap-3 p-4" aria-busy="true">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <EmptyState
              inset
              icon={<InboxIcon />}
              title={filtered ? "No tickets match" : state === "open" ? "No open tickets" : "No tickets"}
              description={filtered ? "Change or clear the filters." : "New bug reports, feature requests and improvements appear here."}
              action={
                filtered && (
                  <Button variant="outline" size="sm" onClick={() => setParams(state === "open" ? {} : { state })}>
                    Clear filters
                  </Button>
                )
              }
            />
          ) : (
            <InboxList label="Tickets">
              {tickets.map((ticket) => (
                <InboxItem
                  key={ticket.uuid}
                  to={`/tickets/${ticket.uuid}${suffix}`}
                  current={ticket.uuid === ticketUuid}
                  tone={stripe(ticket)}
                  title={
                    <span className={ticket.unread ? "font-semibold" : "font-normal"}>
                      {ticket.unread && <span className="sr-only">Unread: </span>}
                      {ticket.title}
                    </span>
                  }
                  mark={<Status value={ticket.status} domain="ticket" />}
                  meta={
                    <>
                      <span className="font-mono">#{ticket.number}</span> · {ticketTypeLabels[ticket.type]} ·{" "}
                      {ticket.organization?.name ?? "Deleted organization"} · {ticket.reporter.name} ·{" "}
                      <RelativeTime at={ticket.last_activity_at} />
                    </>
                  }
                  extra={
                    ticket.awaiting_team || ticket.assignee || ticket.priority !== "normal" ? (
                      <>
                        {[
                          ticket.awaiting_team ? "Awaiting reply" : null,
                          ticket.priority !== "normal" ? `${statusOf(ticket.priority, "priority").label} priority` : null,
                          ticket.assignee ? `Assigned to ${ticket.assignee.name}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </>
                    ) : undefined
                  }
                />
              ))}
            </InboxList>
          )}
          {list.data && (
            <div className="border-t px-4 py-2 empty:hidden">
              <Pager page={page} pageCount={list.data.meta.last_page} onPageChange={(next) => change("page", next > 1 ? String(next) : null)} label="Ticket pages" />
            </div>
          )}
        </>
      }
      detail={
        ticketUuid ? (
          <TicketDetail
            key={ticketUuid}
            uuid={ticketUuid}
            assignees={people}
            back={narrowDetail ? `/tickets${suffix}` : undefined}
            listPath={`/tickets${suffix}`}
            onChanged={refreshList}
          />
        ) : wide ? (
          <EmptyState
            inset
            className="min-h-64"
            icon={<InboxIcon />}
            title="Choose a ticket"
            description={
              list.data?.meta.awaiting
                ? `${list.data.meta.awaiting} open ${list.data.meta.awaiting === 1 ? "ticket is" : "tickets are"} awaiting a reply.`
                : "Nothing is awaiting a reply."
            }
          />
        ) : null
      }
    />
  )
}

function TicketDetail({
  uuid,
  assignees,
  back,
  listPath,
  onChanged,
}: {
  uuid: string
  assignees: TicketCandidate[]
  back?: string
  listPath: string
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const polled = usePolled(() => apiClient.adminTicket(uuid), uuid, 30_000)
  const ticket = polled.data
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Opening the ticket reads it up to what the page shows.
  const sequence = ticket?.sequence
  useEffect(() => {
    if (sequence === undefined || document.visibilityState !== "visible") return
    void apiClient.markAdminTicketRead(uuid, sequence).then(onChanged).catch(() => undefined)
  }, [uuid, sequence])

  function show(next: AdminTicket) {
    polled.setData(next)
    onChanged()
  }

  async function update(changes: Omit<AdminTicketChanges, "revision">) {
    if (!ticket) return
    setSaving(true)
    try {
      show(await apiClient.updateAdminTicket(uuid, { revision: ticket.revision, ...changes }))
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Someone else changed this ticket. It has been reloaded; check it and try again.")
        await polled.reload()
      } else {
        toast.error(errorMessage(error))
      }
    } finally {
      setSaving(false)
    }
  }

  if (!ticket)
    return (
      <PanelContent>
        {polled.error ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-destructive">{errorMessage(polled.error)}</p>
            <Button variant="outline" size="sm" asChild>
              <Link to={listPath}>Back to tickets</Link>
            </Button>
          </div>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </PanelContent>
    )

  return (
    <>
      <PanelHeader>
        {back && (
          <Button variant="ghost" size="sm" className="-ml-2 self-start" asChild>
            <Link to={back}>
              <ArrowLeftIcon data-icon="inline-start" />
              Tickets
            </Link>
          </Button>
        )}
        <PanelTitle className="text-title">
          <span className="mr-2 font-mono text-muted-foreground">#{ticket.number}</span>
          {ticket.title}
        </PanelTitle>
        <PanelDescription>
          {ticket.organization?.name ?? "Deleted organization"} · {ticketTypeLabels[ticket.type]} · filed{" "}
          <RelativeTime at={ticket.created_at} />
        </PanelDescription>
        <PanelActions>
          <Button variant="ghost" size="icon-sm" aria-label="Rename ticket" onClick={() => setRenaming(true)}>
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete ticket" onClick={() => setDeleting(true)}>
            <Trash2Icon />
          </Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <TicketThread items={ticket.timeline} fileHref={(attachment) => apiClient.adminTicketAttachmentUrl(uuid, attachment)} />
          <TeamComposer ticket={ticket} onSent={show} onConflict={() => void polled.reload()} />
        </div>
        <aside aria-label="Ticket properties" className="flex min-w-0 flex-col gap-4">
          <SelectField
            label="Status"
            value={ticket.status}
            disabled={saving}
            options={ticketStatuses.map((value) => ({ value, label: statusOf(value, "ticket").label }))}
            onChange={(value) => void update({ status: value as TicketStatus })}
          />
          <SelectField
            label="Priority"
            value={ticket.priority}
            disabled={saving}
            options={ticketPriorities.map((value) => ({ value, label: statusOf(value, "priority").label }))}
            onChange={(value) => void update({ priority: value as AdminTicketChanges["priority"] })}
          />
          <SelectField
            label="Type"
            value={ticket.type}
            disabled={saving}
            options={ticketTypes}
            onChange={(value) => void update({ type: value as AdminTicketChanges["type"] })}
          />
          <SelectField
            label="Assignee"
            value={ticket.assignee ? String(ticket.assignee.id) : ""}
            disabled={saving}
            options={[{ value: "", label: "Unassigned" }, ...assignees.map((person) => ({ value: String(person.id), label: person.name }))]}
            onChange={(value) => void update({ assignee_id: value ? Number(value) : null })}
          />
          <People ticket={ticket} onChange={show} />
          <section aria-labelledby="ticket-context" className="flex flex-col gap-1">
            <h3 id="ticket-context" className="text-meta font-medium text-muted-foreground">
              Reported context
            </h3>
            <PropertyList
              items={[
                { label: "Reporter", value: ticket.people[0] ? `${ticket.people[0].name} · ${ticket.people[0].email}` : "Unknown" },
                { label: "Page", value: <span className="font-mono text-code break-all">{ticket.context.path ?? "Not recorded"}</span> },
                { label: "Browser", value: <span className="break-all">{ticket.context.user_agent ?? "Not recorded"}</span> },
                { label: "Screen", value: ticket.context.screen ?? "Not recorded" },
                { label: "Time zone", value: ticket.context.time_zone ?? "Not recorded" },
              ]}
            />
            <p className="text-meta text-muted-foreground">As the reporter's browser sent it; not verified.</p>
          </section>
        </aside>
      </PanelContent>
      <Rename ticket={ticket} open={renaming} onOpenChange={setRenaming} onSaved={show} />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ticket #{ticket.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its messages, history and attachments are removed for everyone and cannot be restored. Use this for
              spam or a ticket filed by mistake; decline anything else.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await apiClient.deleteAdminTicket(uuid)
                  setDeleting(false)
                  toast.success(`Ticket #${ticket.number} deleted.`)
                  onChanged()
                  navigate(listPath, { replace: true })
                } catch (error) {
                  toast.error(errorMessage(error))
                }
              }}
            >
              Delete ticket
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** A reply or an internal note, with an optional status change sent in the same action. */
function TeamComposer({
  ticket,
  onSent,
  onConflict,
}: {
  ticket: AdminTicket
  onSent: (ticket: AdminTicket) => void
  onConflict: () => void
}) {
  const [body, setBody] = useState("")
  const [files, setFiles] = useState<ComposerFile[]>([])
  const [kind, setKind] = useState<"reply" | "note">("reply")
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const attempt = useRef<{ id: string; signature: string } | null>(null)
  const note = kind === "note"

  async function send() {
    const valid = files.filter((entry) => !entry.error).map((entry) => entry.file)
    const signature = JSON.stringify([kind, status, body, valid.map((file) => [file.name, file.size])])
    if (attempt.current?.signature !== signature) attempt.current = { id: clientId(), signature }
    setBusy(true)
    try {
      onSent(
        await apiClient.adminTicketMessage(
          ticket.uuid,
          {
            client_id: attempt.current.id,
            body,
            internal: note,
            ...(status ? { status: status as TicketStatus, revision: ticket.revision } : {}),
          },
          valid,
        ),
      )
      setBody("")
      setFiles([])
      setStatus("")
      attempt.current = null
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Someone else changed this ticket. It has been reloaded; your message is kept.")
        onConflict()
      } else {
        toast.error(errorMessage(error))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          aria-label="Message kind"
          value={kind}
          onValueChange={(value) => value && setKind(value as "reply" | "note")}
        >
          <ToggleGroupItem value="reply">Reply</ToggleGroupItem>
          <ToggleGroupItem value="note">Internal note</ToggleGroupItem>
        </ToggleGroup>
        <div className="w-52">
        <SelectField
          label="Then set the status"
          labelHidden
          value={status}
          options={[
            { value: "", label: "Keep the status" },
            ...ticketStatuses.filter((value) => value !== ticket.status).map((value) => ({ value, label: `Set to ${statusOf(value, "ticket").label}` })),
          ]}
          onChange={setStatus}
        />
        </div>
      </div>
      <Composer
        label={note ? "Internal note" : "Reply to the reporter"}
        placeholder={note ? "Only the team sees internal notes…" : "Write a reply; the reporter and tagged people are emailed…"}
        submitLabel={note ? "Add note" : "Send reply"}
        value={body}
        onValueChange={setBody}
        files={files}
        onFilesChange={setFiles}
        onSubmit={() => void send()}
        pending={busy}
        hint={note ? "Not visible to the reporter" : undefined}
        className={note ? "[&_[data-slot=input-group]]:border-dashed [&_[data-slot=input-group]]:border-warning/60" : undefined}
      />
    </div>
  )
}

function People({ ticket, onChange }: { ticket: AdminTicket; onChange: (ticket: AdminTicket) => void }) {
  const [search, setSearch] = useState("")
  const candidates = usePolled(
    () => (ticket.organization ? apiClient.adminTicketPeople(ticket.uuid, search) : Promise.resolve([])),
    `${ticket.uuid}:${search}`,
  )
  const full = ticket.people.length > 10

  async function act(action: () => Promise<AdminTicket>) {
    try {
      onChange(await action())
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <section aria-labelledby="ticket-people" className="flex flex-col gap-2">
      <h3 id="ticket-people" className="text-meta font-medium text-muted-foreground">
        People
      </h3>
      <ul className="flex flex-col gap-1.5">
        {ticket.people.map((person) => (
          <li key={person.id} className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body">{person.name}</p>
              <p className="truncate text-meta text-muted-foreground">
                {person.role === "reporter" ? "Reporter" : "Tagged"} · {person.email}
              </p>
            </div>
            {person.role === "participant" && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${person.name}`}
                onClick={() => void act(() => apiClient.removeAdminTicketParticipant(ticket.uuid, person.id))}
              >
                <XIcon />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {ticket.organization && (
        <SearchableSelect
          label="Tag someone"
          labelHidden
          value=""
          options={(candidates.data ?? []).map((person) => ({ value: String(person.id), label: `${person.name} · ${person.email}` }))}
          onChange={(value) => value && void act(() => apiClient.addAdminTicketParticipant(ticket.uuid, Number(value)))}
          search={search}
          onSearchChange={setSearch}
          loading={candidates.loading}
          disabled={full}
          placeholder={full ? "10 people tagged" : `Tag someone from ${ticket.organization.name}`}
          emptyText="No one else in this organization matches."
        />
      )}
    </section>
  )
}

function Rename({
  ticket,
  open,
  onOpenChange,
  onSaved,
}: {
  ticket: AdminTicket
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (ticket: AdminTicket) => void
}) {
  const [title, setTitle] = useState(ticket.title)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  useEffect(() => {
    if (open) {
      setTitle(ticket.title)
      setErrors(null)
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
            try {
              onSaved(await apiClient.updateAdminTicket(ticket.uuid, { revision: ticket.revision, title }))
              onOpenChange(false)
            } catch (error) {
              const fields = validationErrors(error)
              if (fields) setErrors(fields)
              else toast.error(error instanceof ApiError && error.status === 409 ? "Someone else changed this ticket. Close this and try again." : errorMessage(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename ticket #{ticket.number}</DialogTitle>
          </DialogHeader>
          <TextField
            label="Title"
            value={title}
            maxLength={150}
            autoFocus
            error={fieldMessages(errors, "title")?.[0]}
            onChange={(event) => setTitle(event.target.value)}
          />
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
