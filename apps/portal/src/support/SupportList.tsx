import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { LifeBuoyIcon, PlusIcon } from "lucide-react"
import { ticketTypes, type TicketSummary, type TicketType } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Status } from "@iot-os/ui/components/status-mark"
import { ticketTypeLabels } from "@iot-os/ui/components/ticket-thread"
import { useUrlState } from "@iot-os/ui/hooks/use-url-state"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { RequestError } from "../components/forms"
import { api } from "../lib/api"
import { newTicketPath, supportPath } from "./model"

/** Your bug reports, feature requests and improvements, and the ones you were tagged on. */
export function SupportList() {
  const org = useParams().organizationUuid!
  const state = useUrlState()
  const search = state.get("search")
  const status = state.get("status") || "all"
  const type = state.get("type") as TicketType | ""
  const page = Number(state.get("page") || 1)
  const list = useQuery({
    queryKey: ["tickets", org, search, status, type, page],
    queryFn: () =>
      api.tickets(org, new URLSearchParams({ search, status, page: String(page), ...(type ? { type } : {}) })),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })

  const columns = useMemo<DataColumn<TicketSummary>[]>(
    () => [
      {
        id: "ticket",
        header: "Ticket",
        mobile: "title",
        className: "max-w-96",
        value: (ticket) => ticket.title,
        cell: (ticket) => (
          <>
            <span className="flex min-w-0 items-center gap-2">
              {ticket.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" role="img" />}
              <RowLink to={supportPath(org, `/${ticket.uuid}`)} className={ticket.unread ? "truncate font-semibold" : "truncate"}>
                {ticket.title}
              </RowLink>
            </span>
            <p className="text-meta text-muted-foreground">
              <span className="font-mono">#{ticket.number}</span> ·{" "}
              {ticket.role === "reporter" ? "Filed by you" : `Filed by ${ticket.reporter.name}; you are tagged`}
            </p>
          </>
        ),
      },
      {
        id: "type",
        header: "Type",
        value: (ticket) => ticketTypeLabels[ticket.type],
        cell: (ticket) => ticketTypeLabels[ticket.type],
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        value: (ticket) => ticket.status,
        cell: (ticket) => <Status value={ticket.status} domain="ticket" />,
      },
      {
        id: "activity",
        header: "Last activity",
        value: (ticket) => ticket.last_activity_at,
        cell: (ticket) => <RelativeTime at={ticket.last_activity_at} />,
      },
    ],
    [org],
  )

  return (
    <CollectionPage
      title="Support"
      description="Report a problem or suggest an improvement. The platform team answers here."
      actions={
        <Button size="sm" asChild>
          <Link to={newTicketPath(org)}>
            <PlusIcon data-icon="inline-start" />
            New ticket
          </Link>
        </Button>
      }
    >
      <DataTable
        id="support-tickets"
        label="Tickets"
        noun={["ticket", "tickets"]}
        rows={list.data?.data}
        rowKey={(ticket) => ticket.uuid}
        rowHref={(ticket) => supportPath(org, `/${ticket.uuid}`)}
        columns={columns}
        error={list.error ? <RequestError error={list.error} /> : undefined}
        views={{
          label: "Tickets",
          value: status,
          options: [
            { value: "all", label: "All" },
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
          ],
          onChange: (value) => state.set({ status: value === "all" ? null : value }),
        }}
        search={{
          label: "Search tickets",
          placeholder: "Search titles or #number",
          value: search,
          onChange: (value) => state.set({ search: value }),
        }}
        filters={[
          {
            id: "type",
            label: "Type",
            options: ticketTypes,
            value: type ? [type] : [],
            onChange: (value) => state.set({ type: value[0] ?? null }),
          },
        ]}
        filtered={Boolean(search || type || status !== "all")}
        onReset={() => state.clear(["search", "type", "status"])}
        pagination={{
          page,
          pageSize: 25,
          total: list.data?.meta.total ?? 0,
          pageCount: list.data?.meta.last_page,
          onPageChange: (next) => state.set({ page: next > 1 ? String(next) : null }),
        }}
        refreshSeconds={60}
        empty={
          <EmptyState
            inset
            icon={<LifeBuoyIcon />}
            title="No tickets yet"
            description="Tell the platform team about a bug, or suggest a feature or an improvement."
            action={
              <Button size="sm" asChild>
                <Link to={newTicketPath(org)}>New ticket</Link>
              </Button>
            }
          />
        }
      />
    </CollectionPage>
  )
}
