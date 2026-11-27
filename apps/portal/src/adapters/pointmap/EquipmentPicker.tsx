import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { opcuaAddress } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Checkbox } from "@iot-os/ui/components/checkbox";
import { TextField } from "@iot-os/ui/components/form-fields";
import { Input } from "@iot-os/ui/components/input";
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { Status } from "@iot-os/ui/components/status-mark";
import { ArrowLeftIcon } from "lucide-react";
import { RequestError } from "../../components/forms";
import { api } from "../../lib/api";
import { formatValue } from "../sources/opcua";
import { AddressTree, type AddressRow } from "./AddressTree";
import { tagPattern, tagPrefix, type Template, type TickedPoint } from "./model";

const PAGE_LIMIT = 200;
/** 10,000 nodes at 200 a page. */
const MAX_PAGES = 50;

/**
 * Step one of a point map (spec 038 US3): pick one equipment in the tree, then tick the
 * points to collect from it. A folder of flat tags works the same way, with the tag
 * prefix that names the equipment.
 */
export function EquipmentPicker({
  org,
  connection,
  busy,
  onPicked,
}: {
  org: string;
  connection: string;
  busy: boolean;
  onPicked: (template: Template, points: TickedPoint[]) => void;
}) {
  const [picked, setPicked] = useState<AddressRow | null>(null);
  if (!picked)
    return (
      <AddressTree
        org={org}
        connection={connection}
        description="Open the tree to one piece of equipment, such as a zone controller, and choose Map this. For a folder of flat tags, map the folder."
        rowActions={(row) =>
          row.kind !== "point" && row.has_children ? (
            <Button size="sm" variant="outline" onClick={() => setPicked(row)}>
              Map this
            </Button>
          ) : null
        }
      />
    );
  return <PointList org={org} connection={connection} equipment={picked} busy={busy} onBack={() => setPicked(null)} onPicked={onPicked} />;
}

function PointList({
  org,
  connection,
  equipment,
  busy,
  onBack,
  onPicked,
}: {
  org: string;
  connection: string;
  equipment: AddressRow;
  busy: boolean;
  onBack: () => void;
  onPicked: (template: Template, points: TickedPoint[]) => void;
}) {
  const flat = equipment.kind === "folder";
  const [ticked, setTicked] = useState<Map<string, TickedPoint>>(new Map());
  const [filter, setFilter] = useState("");
  const [prefixText, setPrefixText] = useState<string | null>(null);
  const nodes = useInfiniteQuery({
    queryKey: ["opcua-nodes", org, connection, opcuaAddress(equipment)],
    queryFn: ({ pageParam, signal }) => api.opcuaNodes(org, connection, opcuaAddress(equipment), pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.cursor ?? undefined,
    staleTime: 60_000,
    retry: false,
  });
  // A filter looks through the whole folder: a flat list keeps thousands of tags in one.
  const pages = nodes.data?.pages.length ?? 0;
  useEffect(() => {
    if (filter.trim() && nodes.hasNextPage && !nodes.isFetchingNextPage && pages < MAX_PAGES) void nodes.fetchNextPage();
  }, [filter, nodes.hasNextPage, nodes.isFetchingNextPage, pages]); // eslint-disable-line react-hooks/exhaustive-deps
  const points = useMemo(
    () => (nodes.data?.pages.flatMap((page) => page.items) ?? []).filter((n) => n.kind === "point" && n.display_name.toLowerCase().includes(filter.trim().toLowerCase())),
    [nodes.data, filter],
  );
  const shown = points.slice(0, PAGE_LIMIT);
  const values = useQuery({
    queryKey: ["opcua-values", org, connection, shown.map(opcuaAddress)],
    queryFn: () => api.readOpcuaNodes(org, connection, shown.map(opcuaAddress)),
    enabled: shown.length > 0,
    retry: false,
  });
  const byAddress = new Map((values.data?.points ?? []).map((p) => [opcuaAddress(p), p]));
  const tickedList = [...ticked.values()];
  const prefix = prefixText ?? tagPrefix(tickedList.map((p) => p.name));
  const unmatched = flat ? tickedList.filter((p) => !tagPattern(p.name, prefix)) : [];
  const toggle = (point: TickedPoint, on: boolean) =>
    setTicked((current) => {
      const next = new Map(current);
      if (on) next.set(opcuaAddress(point.node), point);
      else next.delete(opcuaAddress(point.node));
      return next;
    });
  const template: Template = flat
    ? { kind: "tags", folder: equipment.path, prefix: prefix.trim(), namespace_uri: equipment.namespace_uri }
    : { kind: "node", node: equipment, path: equipment.path };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{flat ? `Tags in ${equipment.display_name}` : `Points of ${equipment.display_name}`}</PanelTitle>
        <PanelDescription>
          Tick what to collect. Greyed points hold values the platform cannot store.
          {flat && " The tag prefix names one piece of equipment; the other parts of each tag find the same point on similar equipment."}
        </PanelDescription>
        <PanelActions>
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeftIcon />
            Back to the tree
          </Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <div className="flex max-w-form flex-col gap-3">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={flat ? "Filter tags, for example L03_VAV_2" : "Filter points"} aria-label="Filter points" />
          {flat && (
            <TextField
              label="Tag prefix of this equipment"
              value={prefix}
              onChange={(e) => setPrefixText(e.target.value)}
              help="Worked out from the ticked tags; for example ET_L03_VAV_2 in ET_L03_VAV_2.ZN-T."
              error={unmatched.length ? `${unmatched.map((p) => p.name).join(", ")} ${unmatched.length === 1 ? "does" : "do"} not start with this prefix.` : undefined}
              spellCheck={false}
            />
          )}
        </div>
        <RequestError error={nodes.error ?? values.error} />
        <ul className="flex flex-col divide-y rounded-lg border" aria-label={flat ? "Tags" : "Points"}>
          {nodes.isPending && <li className="px-3 py-2 text-muted-foreground">Loading…</li>}
          {!nodes.isPending && shown.length === 0 && <li className="px-3 py-2 text-muted-foreground">No points{filter ? " match" : " here"}.</li>}
          {shown.map((node) => {
            const point = byAddress.get(opcuaAddress(node));
            const refused = point && !point.storable ? point.not_storable || "The platform cannot store this point" : null;
            const id = `point-${opcuaAddress(node)}`;
            return (
              <li key={opcuaAddress(node)} className="flex items-center gap-3 px-3 py-2" title={refused ?? undefined}>
                <Checkbox
                  id={id}
                  checked={ticked.has(opcuaAddress(node))}
                  disabled={Boolean(refused) || !point}
                  onCheckedChange={(on) => toggle({ node, name: node.name }, on === true)}
                  aria-describedby={refused ? `${id}-why` : undefined}
                />
                <label htmlFor={id} className={refused ? "min-w-0 flex-1 text-muted-foreground" : "min-w-0 flex-1"}>
                  <span className="block truncate">{node.display_name}</span>
                  {refused && (
                    <span id={`${id}-why`} className="block text-meta">
                      {refused}
                    </span>
                  )}
                </label>
                <span className="text-body whitespace-nowrap tabular-nums">{formatValue(point)}</span>
                {point && <Status value={point.quality} domain="opcua_quality" />}
              </li>
            );
          })}
        </ul>
        {(points.length > PAGE_LIMIT || nodes.hasNextPage) && (
          <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
            {points.length > PAGE_LIMIT && <span>Showing {PAGE_LIMIT} of {points.length}; filter to find others.</span>}
            {nodes.hasNextPage && (
              <Button variant="ghost" size="sm" disabled={nodes.isFetchingNextPage} onClick={() => void nodes.fetchNextPage()}>
                Load more
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy || !ticked.size || (flat && (!prefix.trim() || unmatched.length > 0))} onClick={() => onPicked(template, tickedList)}>
            {busy ? "Suggesting…" : `Use ${ticked.size || ""} ${ticked.size === 1 ? "point" : "points"}`.replace("  ", " ")}
          </Button>
          <span className="text-meta text-muted-foreground">Keys, names and units are suggested from the server; you can change them next.</span>
        </div>
      </PanelContent>
    </Panel>
  );
}
