import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { opcuaAddress, type PointMap } from "@iot-os/api-client";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { SegmentedControl, SegmentedControlItem } from "@iot-os/ui/components/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table";
import { SearchIcon, Trash2Icon } from "lucide-react";
import { RequestError } from "../../components/forms";
import { api } from "../../lib/api";
import { addEquipment, equipmentOf } from "./model";

type By = "type" | "names" | "pattern";

/**
 * Step three of a point map (spec 038 US3 scenarios 3 and 4): find equipment like the
 * first, by the server's declared type, by matching point names, or by the tag pattern
 * of a flat list; each shows the readings it lacks, and any can be removed.
 */
export function SimilarEquipment({ org, connection, map, onChange, disabled }: { org: string; connection: string; map: PointMap; onChange: (map: PointMap) => void; disabled: boolean }) {
  const first = map.equipment[0];
  const flat = map.readings.some((r) => r.address.relative_path.some((s) => "pattern" in s));
  const [by, setBy] = useState<By>(flat ? "pattern" : "type");
  const [note, setNote] = useState("");
  const find = useMutation({
    mutationFn: () =>
      api.similarOpcuaEquipment(org, connection, {
        equipment: { node: first.address.node_id ? opcuaAddress({ node_id: first.address.node_id, namespace_uri: first.address.namespace_uri }) : null, path: first.address.path },
        points: map.readings.map((r) => {
          const step = r.address.relative_path.at(-1)!;
          return "pattern" in step ? { key: r.key, pattern: step.pattern } : { key: r.key, name: step.name };
        }),
        by,
      }),
    onSuccess: ({ matches, truncated }) => {
      const next = addEquipment(map.equipment, matches.map((m) => equipmentOf(m, first.address.namespace_uri)));
      const added = next.length - map.equipment.length;
      setNote(
        matches.length === 0
          ? by === "type"
            ? "Nothing found by declared type; the server may not declare one. Try matching names."
            : "Nothing similar found."
          : `${matches.length} found, ${added} new.${truncated ? " The search stopped at 20,000 nodes; some may be missing." : ""}`,
      );
      onChange({ ...map, equipment: next });
    },
  });
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Equipment</PanelTitle>
        <PanelDescription>
          {map.equipment.length} {map.equipment.length === 1 ? "device" : "devices"}. Each becomes a device once collecting starts.
        </PanelDescription>
        <PanelActions>
          {flat ? (
            <Badge variant="outline">By tag pattern</Badge>
          ) : (
            <SegmentedControl
              aria-label="Find similar equipment by"
              value={by}
              onValueChange={(value) => setBy(value as By)}
            >
              <SegmentedControlItem value="type">Declared type</SegmentedControlItem>
              <SegmentedControlItem value="names">Point names</SegmentedControlItem>
            </SegmentedControl>
          )}
          <Button size="sm" variant="outline" disabled={disabled || find.isPending} onClick={() => find.mutate()}>
            <SearchIcon />
            {find.isPending ? "Looking…" : "Find similar"}
          </Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">
        <RequestError error={find.error} />
        {note && (
          <p role="status" className="text-meta text-muted-foreground">
            {note}
          </p>
        )}
        <div className="overflow-x-auto">
          <Table aria-label="Equipment">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>Lacks</TableHead>
                <TableHead>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {map.equipment.map((equipment, index) => (
                <TableRow key={equipment.source_id}>
                  <TableCell className="font-medium">{equipment.display_name}</TableCell>
                  <TableCell className="text-meta text-muted-foreground">{equipment.address.path.slice(0, -1).map((s) => s.name).join(" / ")}</TableCell>
                  <TableCell>
                    {equipment.missing?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {equipment.missing.map((key) => (
                          <Badge key={key} variant="outline">
                            {map.readings.find((r) => r.key === key)?.name ?? key}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-meta text-muted-foreground">Nothing</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${equipment.display_name}`}
                      disabled={disabled || index === 0}
                      onClick={() => onChange({ ...map, equipment: map.equipment.filter((e) => e.source_id !== equipment.source_id) })}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PanelContent>
    </Panel>
  );
}
