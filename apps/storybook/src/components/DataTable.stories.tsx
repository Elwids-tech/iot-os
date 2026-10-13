import { useMemo, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, RefLink, RowLink, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { Freshness } from "@iot-os/ui/components/freshness"
import { Status } from "@iot-os/ui/components/status-mark"
import { fleet, now, type FixtureDevice } from "../fixtures"

const meta: Meta = { title: "Components/DataTable" }
export default meta

const lifecycles = ["registered", "active", "deactivated", "archived"] as const

function Fleet({ rows = fleet }: { rows?: FixtureDevice[] }) {
  const [lifecycle, setLifecycle] = useState("all")
  const [search, setSearch] = useState("")
  const [profiles, setProfiles] = useState<string[]>([])
  const [sites, setSites] = useState<string[]>([])
  const columns = useMemo<DataColumn<FixtureDevice>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        mobile: "title",
        sortable: true,
        searchable: true,
        value: (d) => d.name,
        cell: (d) => (
          <>
            <RowLink to={`/devices/${d.uuid}`} className="block truncate">{d.name}</RowLink>
            <span className="font-mono text-meta text-muted-foreground">{d.code}</span>
          </>
        ),
      },
      { id: "status", header: "Status", mobile: "badge", sortable: true, value: (d) => d.presence, cell: (d) => <Status value={d.lifecycle === "active" ? d.presence : d.lifecycle} /> },
      { id: "last-seen", header: "Last seen", sortable: true, value: (d) => d.lastSeen, cell: (d) => <Freshness at={d.lastSeen} expectedSeconds={d.expected} now={now} /> },
      { id: "profile", header: "Profile", sortable: true, value: (d) => d.profile, cell: (d) => (d.profile ? <RefLink to="/device-profiles">{d.profile}</RefLink> : <span className="text-muted-foreground">None</span>) },
      { id: "gateway", header: "Gateway", mobile: "hidden", value: (d) => d.gateway, cell: (d) => d.gateway ?? <span className="text-muted-foreground">None</span> },
      { id: "site", header: "Site", mobile: "hidden", hidden: true, value: (d) => d.site, cell: (d) => d.site ?? <span className="text-muted-foreground">None</span> },
      { id: "readings", header: "Readings, 24 h", align: "end", sortable: true, summary: "sum", value: (d) => d.readings, cell: (d) => d.readings.toLocaleString() },
    ],
    [],
  )
  const inView = lifecycle === "all" ? rows : rows.filter((d) => d.lifecycle === lifecycle)
  return (
    <DataTable
      id="story-fleet"
      label="Devices"
      noun={["device", "devices"]}
      rows={inView}
      rowKey={(d) => d.uuid}
      rowHref={(d) => `/devices/${d.uuid}`}
      columns={columns}
      defaultSort={[{ id: "device", desc: false }]}
      views={{
        label: "Lifecycle",
        value: lifecycle,
        onChange: setLifecycle,
        options: [
          { value: "all", label: "All", count: rows.length },
          ...lifecycles.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1), count: rows.filter((d) => d.lifecycle === value).length })),
        ],
      }}
      search={{ label: "Search devices", placeholder: "Search name or code", value: search, onChange: setSearch }}
      filters={[
        { id: "profile", label: "Profile", multiple: true, options: [...new Set(rows.map((d) => d.profile).filter(Boolean))].map((p) => ({ value: p!, label: p! })), value: profiles, onChange: setProfiles, match: (d, value) => value.includes(d.profile ?? "") },
        { id: "site", label: "Site", options: [...new Set(rows.map((d) => d.site).filter(Boolean))].map((s) => ({ value: s!, label: s! })), value: sites, onChange: setSites, match: (d, value) => value.includes(d.site ?? "") },
      ]}
      groups={[
        { id: "gateway", label: "Gateway", value: (d) => d.gateway },
        { id: "profile", label: "Profile", value: (d) => d.profile },
        { id: "site", label: "Site", value: (d) => d.site },
      ]}
      onReset={() => setLifecycle("all")}
      selectable
      exportName="devices"
      bulkActions={({ ids, clear }) => (
        <Button variant="outline" size="sm" onClick={clear}>
          Archive {ids.length}
        </Button>
      )}
      rowActions={() => (
        <>
          <DropdownMenuItem>Configuration</DropdownMenuItem>
          <DropdownMenuItem>Command log</DropdownMenuItem>
          <DropdownMenuItem>Copy device code</DropdownMenuItem>
        </>
      )}
      refreshSeconds={15}
    />
  )
}

/**
 * Every Filament-style feature on loaded rows: saved views with counts, search,
 * filters with chips, Group, Columns, sorting, selection with Select all and
 * Export CSV, row actions, a summary row and client paging.
 */
export const AllFeatures: StoryObj = { render: () => <Fleet /> }

/** No rows and nothing filtered: the page's empty state sits inside the panel. */
export const Empty: StoryObj = { render: () => <Fleet rows={[]} /> }

/** First load: skeleton rows that match the columns, and the count says Loading. */
export const Loading: StoryObj = {
  render: () => (
    <DataTable
      id="story-loading"
      label="Devices"
      noun={["device", "devices"]}
      rows={undefined}
      rowKey={(d: FixtureDevice) => d.uuid}
      columns={[
        { id: "device", header: "Device", cell: (d) => d.name },
        { id: "status", header: "Status", cell: (d) => d.presence },
        { id: "last-seen", header: "Last seen", cell: (d) => d.lastSeen },
      ]}
    />
  ),
}

type Reading = { id: string; at: number; value: number; configuration: number }
const readings: Reading[] = Array.from({ length: 120 }, (_, index) => ({
  id: `reading-${index}`,
  at: now - index * 60_000,
  value: Math.round((21 + Math.sin(index / 6) * 2) * 10) / 10,
  configuration: index < 70 ? 4 : 3,
}))

function ReadingLog() {
  const [loaded, setLoaded] = useState(40)
  const [loading, setLoading] = useState(false)
  return (
    <DataTable
      id="story-readings"
      label="Temperature records"
      noun={["record", "records"]}
      rows={readings.slice(0, loaded)}
      rowKey={(r) => r.id}
      columns={[
        { id: "at", header: "Received", mobile: "title", value: (r) => r.at, cell: (r) => new Date(r.at).toLocaleString() },
        { id: "value", header: "Value", mobile: "badge", align: "end", value: (r) => r.value, cell: (r) => <span className="tabular-nums">{r.value} °C</span> },
      ]}
      bounded
      separator={(row, previous) =>
        row.configuration !== previous?.configuration ? `Device configuration ${row.configuration}` : null
      }
      loadMore={{
        hasMore: loaded < readings.length,
        loading,
        label: "Load older",
        note: loaded < readings.length ? "newest first" : "all in this range",
        onLoadMore: () => {
          setLoading(true)
          setTimeout(() => {
            setLoaded((count) => count + 40)
            setLoading(false)
          }, 400)
        },
      }}
    />
  )
}

/**
 * A log from a cursor API with no total: rows scroll under a sticky header,
 * Load older appends the next batch, and a heading marks each configuration run.
 */
export const LoadMoreLog: StoryObj = { render: () => <ReadingLog /> }
