import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { opcuaAddress, type OpcuaNode, type OpcuaPoint, type OpcuaSearchMatch, type PointMapSegment } from "@iot-os/api-client";
import type { ReactNode } from "react";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import { Input } from "@iot-os/ui/components/input";
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { Status } from "@iot-os/ui/components/status-mark";
import { TreeTable, type TreeLevel, type TreeTableColumn } from "@iot-os/ui/components/tree-table";
import { SearchIcon } from "lucide-react";
import { RequestError } from "../../components/forms";
import { api } from "../../lib/api";
import { formatValue } from "../sources/opcua";

/** A node with its path of names from the Objects folder and its current value once read. */
export type AddressRow = OpcuaNode & { path: PointMapSegment[]; point?: OpcuaPoint };

const LIVE_MS = 5_000;

/**
 * One level of a server's address space: browsed a page at a time, with the current
 * value of each point on the level read every few seconds while it is open.
 */
function useAddressLevel(org: string, connection: string) {
  return function useLevel(parent: AddressRow | null): TreeLevel<AddressRow> {
    const parentAddress = parent ? opcuaAddress(parent) : null;
    const nodes = useInfiniteQuery({
      queryKey: ["opcua-nodes", org, connection, parentAddress],
      queryFn: ({ pageParam, signal }) => api.opcuaNodes(org, connection, parentAddress, pageParam, signal),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.cursor ?? undefined,
      staleTime: 60_000,
      retry: false,
    });
    const rows = useMemo(() => nodes.data?.pages.flatMap((page) => page.items), [nodes.data]);
    const points = useMemo(() => (rows ?? []).filter((row) => row.kind === "point").slice(0, 200).map(opcuaAddress), [rows]);
    const values = useQuery({
      queryKey: ["opcua-values", org, connection, points],
      queryFn: () => api.readOpcuaNodes(org, connection, points),
      enabled: points.length > 0,
      refetchInterval: LIVE_MS,
      retry: false,
    });
    const byAddress = useMemo(() => new Map((values.data?.points ?? []).map((point) => [opcuaAddress(point), point])), [values.data]);
    return {
      rows: rows?.map((row) => ({ ...row, path: [...(parent?.path ?? []), { namespace_uri: row.namespace_uri, name: row.name }], point: byAddress.get(opcuaAddress(row)) })),
      hasMore: Boolean(nodes.hasNextPage),
      loadingMore: nodes.isFetchingNextPage,
      onLoadMore: () => void nodes.fetchNextPage(),
      error: nodes.error ? <RequestError error={nodes.error} /> : undefined,
    };
  };
}

const unstorable = (row: AddressRow) => (row.point && row.point.storable === false ? row.point.not_storable || "This point cannot be stored as a reading." : null);

const columns: TreeTableColumn<AddressRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: (row) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{row.display_name}</span>
        {row.type && row.type !== "FolderType" && <span className="truncate text-meta text-muted-foreground">{row.type}</span>}
      </span>
    ),
  },
  {
    id: "value",
    header: "Value",
    align: "end",
    cell: (row) => (row.kind === "point" ? <span className="whitespace-nowrap">{formatValue(row.point)}</span> : null),
  },
  {
    id: "quality",
    header: "Status",
    cell: (row) => (row.point ? <Status value={row.point.quality} domain="opcua_quality" title={row.point.status} /> : null),
  },
  {
    id: "type",
    header: "Data type",
    phoneHidden: true,
    cell: (row) => (row.kind === "point" ? <span className="text-meta">{unstorable(row) ?? row.point?.data_type ?? ""}</span> : null),
  },
  {
    id: "time",
    header: "Server time",
    phoneHidden: true,
    cell: (row) => (row.point?.source_time ? <RelativeTime at={row.point.source_time} className="text-meta" /> : null),
  },
];

const matchColumns: DataColumn<OpcuaSearchMatch>[] = [
  {
    id: "name",
    header: "Name",
    value: (match) => match.display_name,
    cell: (match) => (
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{match.display_name}</span>
        <span className="text-meta text-muted-foreground">{match.path.map((step) => step.name).join(" / ")}</span>
      </span>
    ),
  },
  {
    id: "kind",
    header: "Kind",
    cell: (match) => <Badge variant="outline">{match.type ?? match.kind}</Badge>,
  },
];

/** The server's address space, one level at a time, with live values and a name search. */
export function AddressTree({
  org,
  connection,
  rowActions,
  description = "What the server offers, one level at a time. Values refresh every few seconds while a level is open; greyed points cannot be stored as readings.",
}: {
  org: string;
  connection: string;
  /** For example "Map this" on equipment. */
  rowActions?: (row: AddressRow) => ReactNode;
  description?: string;
}) {
  const useLevel = useMemo(() => useAddressLevel(org, connection), [org, connection]);
  const [text, setText] = useState("");
  const search = useMutation({ mutationFn: (query: string) => api.searchOpcuaNodes(org, connection, query) });
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Address space</PanelTitle>
        <PanelDescription>{description}</PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <form
          role="search"
          className="flex max-w-form gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) search.mutate(text.trim());
          }}
        >
          <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Find by name, for example VAV-2" aria-label="Find a node by name" />
          <Button type="submit" variant="outline" disabled={!text.trim() || search.isPending}>
            <SearchIcon />
            Find
          </Button>
        </form>
        <RequestError error={search.error} />
        {search.data && (
          <div className="flex flex-col gap-2">
            <p className="text-meta text-muted-foreground">
              {search.data.matches.length === 0 ? "Nothing matches." : `${search.data.matches.length} found`}
              {search.data.truncated && ` after looking at ${search.data.visited.toLocaleString()} nodes; narrow the search to see more.`}
            </p>
            {search.data.matches.length > 0 && (
              <DataTable
                id="opcua-search"
                label="Search results"
                noun={["match", "matches"]}
                columns={matchColumns}
                rows={search.data.matches}
                rowKey={opcuaAddress}
                rowLabel={(match) => match.display_name}
              />
            )}
          </div>
        )}
        <TreeTable
          label="Address space"
          columns={columns}
          rowKey={opcuaAddress}
          rowLabel={(row) => row.display_name}
          hasChildren={(row) => row.has_children}
          useLevel={useLevel}
          rowMuted={unstorable}
          rowActions={rowActions}
          empty={<p className="p-6 text-center text-muted-foreground">The server shows nothing under Objects.</p>}
        />
      </PanelContent>
    </Panel>
  );
}
