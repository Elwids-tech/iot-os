import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opcuaAddress, type AdapterProfile, type PointMap } from "@iot-os/api-client";
import { Alert, AlertDescription } from "@iot-os/ui/components/alert";
import { Button } from "@iot-os/ui/components/button";
import { FieldDescription, FieldGroup } from "@iot-os/ui/components/field";
import { TextField } from "@iot-os/ui/components/form-fields";
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { RequestError } from "../../components/forms";
import { api } from "../../lib/api";
import { EquipmentPicker } from "./EquipmentPicker";
import { emptyMap, readingAt, templateEquipment, type Template, type TickedPoint } from "./model";
import { ReadingsTable } from "./ReadingsTable";
import { SimilarEquipment } from "./SimilarEquipment";

/**
 * Choosing what to collect from an OPC UA server (spec 038 US3): one equipment and its
 * points, the readings they become, the similar equipment they apply to, and the device
 * type the readings belong to.
 */
export function PointMapEditor({
  org,
  connection,
  map,
  onChange,
  name,
  onName,
  profiles,
  artifactUuid,
  onArtifact,
  canEdit,
}: {
  org: string;
  connection: string;
  map: PointMap | null;
  onChange: (map: PointMap | null) => void;
  name: string;
  onName: (name: string) => void;
  profiles: AdapterProfile[] | undefined;
  artifactUuid: string;
  onArtifact: (uuid: string) => void;
  canEdit: boolean;
}) {
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const suggest = useMutation({
    mutationFn: async ({ template, points }: { template: Template; points: TickedPoint[] }) => {
      const result = await api.suggestOpcuaReadings(
        org,
        connection,
        // A flat tag is named by what follows the equipment's prefix: "ZN-T" in ET_L03_VAV_2.ZN-T.
        points.map((p) => {
          const own = template.kind === "tags" && p.name.startsWith(template.prefix) ? p.name.slice(template.prefix.length).replace(/^[._\-/:]+/, "") || p.name : null;
          return { node: opcuaAddress(p.node), name: own ?? p.name, display_name: own ?? p.node.display_name };
        }),
      );
      return { template, points, ...result };
    },
    onSuccess: ({ template, points, readings, refused: notStored }) => {
      const byNode = new Map(points.map((p) => [opcuaAddress(p.node), p]));
      const kept = points.filter((p) => !notStored.some((r) => r.node === opcuaAddress(p.node)));
      setRefused(notStored);
      onChange({
        ...emptyMap(),
        readings: readings.map((reading, i) => readingAt(reading, byNode.get(opcuaAddress(kept[i].node))!, template)),
        equipment: [templateEquipment(template)],
      });
    },
  });

  if (!map || !map.readings.length)
    return (
      <div className="flex flex-col gap-3">
        <EquipmentPicker org={org} connection={connection} busy={suggest.isPending} onPicked={(template, points) => suggest.mutate({ template, points })} />
        <RequestError error={suggest.error} />
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader>
          <PanelTitle>Point map</PanelTitle>
          <PanelDescription>
            {map.readings.length} {map.readings.length === 1 ? "reading" : "readings"} from {map.equipment[0]?.display_name}, applied to {map.equipment.length}{" "}
            {map.equipment.length === 1 ? "device" : "devices"}.
          </PanelDescription>
          {canEdit && (
            <PanelActions>
              <Button variant="outline" size="sm" onClick={() => onChange(null)}>
                <RotateCcwIcon />
                Pick again
              </Button>
            </PanelActions>
          )}
        </PanelHeader>
        {refused.length > 0 && (
          <PanelContent>
            <Alert>
              <AlertDescription>
                Left out, since the platform cannot store them: {refused.map((r) => `${r.name} (${r.reason})`).join("; ")}.
              </AlertDescription>
            </Alert>
          </PanelContent>
        )}
      </Panel>
      <ReadingsTable map={map} onChange={onChange} disabled={!canEdit} />
      <SimilarEquipment org={org} connection={connection} map={map} onChange={onChange} disabled={!canEdit} />
      <DeviceType org={org} map={map} name={name} onName={onName} profiles={profiles} artifactUuid={artifactUuid} onArtifact={onArtifact} canEdit={canEdit} />
    </div>
  );
}

function DeviceType({
  org,
  map,
  name,
  onName,
  profiles,
  artifactUuid,
  onArtifact,
  canEdit,
}: {
  org: string;
  map: PointMap;
  name: string;
  onName: (name: string) => void;
  profiles: AdapterProfile[] | undefined;
  artifactUuid: string;
  onArtifact: (uuid: string) => void;
  canEdit: boolean;
}) {
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeName, setTypeName] = useState(map.equipment[0]?.display_name.replace(/[-_ ]?\d+$/, "") || "");
  const selected = profiles?.find((p) => p.uuid === artifactUuid);
  const published = new Set(selected?.definition.parameters.filter((p) => p.reports_state && p.kind !== "derived").map((p) => p.key) ?? []);
  const lacking = selected ? map.readings.filter((r) => !published.has(r.key)) : [];
  const create = useMutation({
    mutationFn: () => api.createPointMapDeviceType(org, { name: typeName.trim(), readings: map.readings.map((r) => ({ key: r.key, name: r.name, data_type: r.data_type, unit: r.unit ?? null })) }),
    onSuccess: async (created) => {
      await cache.invalidateQueries({ queryKey: ["adapter-profiles", org] });
      onArtifact(created.artifact_uuid);
      if (!name.trim()) onName(created.name);
      toast.success(`${created.name} is published with these readings.`);
    },
  });
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Name and device type</PanelTitle>
        <PanelDescription>Each device's readings follow a published device type. Use one that has these readings, or make one from them.</PanelDescription>
      </PanelHeader>
      <PanelContent>
        <FieldGroup className="md:grid md:grid-cols-2 md:items-start">
          <TextField label="Data source name" value={name} onChange={(e) => onName(e.target.value)} disabled={!canEdit} placeholder="Zone controllers" />
          <div className="flex min-w-0 flex-col gap-2">
            <SearchableSelect
              label="Device type"
              value={artifactUuid}
              options={(profiles ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).map((p) => ({ value: p.uuid, label: `${p.name} · revision ${p.revision}` }))}
              search={search}
              onSearchChange={setSearch}
              onChange={onArtifact}
              disabled={!canEdit}
              loading={!profiles}
              selectedLabel={selected ? `${selected.name} · revision ${selected.revision}` : undefined}
              error={lacking.length ? `This device type has no reading called ${lacking.map((r) => r.key).join(", ")}.` : undefined}
            />
            <FieldDescription>Or make a new device type with exactly these readings:</FieldDescription>
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="New device type" value={typeName} onChange={(e) => setTypeName(e.target.value)} disabled={!canEdit || create.isPending} placeholder="Zone controller" />
              <Button variant="outline" disabled={!canEdit || create.isPending || !typeName.trim()} onClick={() => create.mutate()}>
                {create.isPending ? "Publishing…" : "Create and publish"}
              </Button>
            </div>
            <RequestError error={create.error} />
          </div>
        </FieldGroup>
      </PanelContent>
    </Panel>
  );
}
