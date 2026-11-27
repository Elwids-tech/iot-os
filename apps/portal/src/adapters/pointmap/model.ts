import type {
  OpcuaNode,
  PointMap,
  PointMapEquipment,
  PointMapReading,
  PointMapSegment,
  SimilarEquipment,
  SuggestedReading,
} from "@iot-os/api-client";

/** FR-031: sampled every 10 seconds, reporting at least every 5 minutes. */
export const DEFAULT_SAMPLE_MS = 10_000;
export const DEFAULT_RHYTHM_SECONDS = 300;
export const FASTEST_SAMPLE_MS = 1_000;

/** A ticked point: its node and the name the map addresses it by. */
export type TickedPoint = { node: OpcuaNode; name: string };

/** Where the mapped equipment sits: a node with points under it, or a tag prefix in a flat folder. */
export type Template =
  | { kind: "node"; node: OpcuaNode; path: PointMapSegment[] }
  | { kind: "tags"; folder: PointMapSegment[]; prefix: string; namespace_uri: string };

export const sourceId = (path: { name: string }[]) => path.map((step) => step.name).join("/");

/** The longest shared start of tag names, cut at the last separator: "ET_L03_VAV_2" from "ET_L03_VAV_2.ZN-T". */
export function tagPrefix(names: string[]): string {
  if (!names.length) return "";
  let prefix = names[0];
  for (const name of names.slice(1)) while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("/"), prefix.lastIndexOf(":"));
  return cut > 0 ? prefix.slice(0, cut) : prefix.replace(/[._\-/:]+$/, "");
}

/** "{equipment}.ZN-T" for "ET_L03_VAV_2.ZN-T" with the prefix "ET_L03_VAV_2"; null when the tag lacks it. */
export function tagPattern(name: string, prefix: string): string | null {
  return prefix && name.startsWith(prefix) && name.length > prefix.length ? `{equipment}${name.slice(prefix.length)}` : null;
}

/** The first equipment of the map: the one the person picked. */
export function templateEquipment(template: Template): PointMapEquipment {
  if (template.kind === "node")
    return {
      source_id: sourceId(template.path),
      display_name: template.node.display_name,
      address: { node_id: template.node.node_id, namespace_uri: template.node.namespace_uri, path: template.path },
    };
  const path = [...template.folder, { namespace_uri: template.namespace_uri, name: template.prefix }];
  return { source_id: sourceId(path), display_name: template.prefix, address: { namespace_uri: template.namespace_uri, path } };
}

/** A suggested reading placed at its point, relative to the equipment. */
export function readingAt(suggested: SuggestedReading, point: TickedPoint, template: Template): PointMapReading {
  const relative_path =
    template.kind === "tags"
      ? [{ namespace_uri: point.node.namespace_uri, pattern: tagPattern(point.name, template.prefix) ?? point.name }]
      : [{ namespace_uri: point.node.namespace_uri, name: point.name }];
  return { scale: 1, offset: 0, ...suggested, unit: suggested.unit ?? null, address: { relative_path } };
}

/** A similar match as map equipment, keeping what it lacks. */
export function equipmentOf(match: SimilarEquipment, fallbackNamespace: string): PointMapEquipment {
  const namespace = match.address.namespace_uri ?? fallbackNamespace;
  const path = match.address.path.map((step) => ({ namespace_uri: step.namespace_uri ?? namespace, name: step.name }));
  return {
    source_id: match.source_id,
    display_name: match.display_name,
    address: { ...(match.address.node_id ? { node_id: match.address.node_id } : {}), namespace_uri: namespace, path },
    ...(match.missing.length ? { missing: match.missing } : {}),
  };
}

/** Adds matches not already in the list, by source id; the first equipment stays first. */
export function addEquipment(list: PointMapEquipment[], more: PointMapEquipment[]): PointMapEquipment[] {
  const have = new Set(list.map((e) => e.source_id));
  return [...list, ...more.filter((e) => !have.has(e.source_id))];
}

/** Removing a reading also drops it from what each equipment lacks or overrides. */
export function removeReading(map: PointMap, key: string): PointMap {
  return {
    ...map,
    readings: map.readings.filter((r) => r.key !== key),
    equipment: map.equipment.map(({ missing, overrides, ...rest }) => {
      const keptMissing = (missing ?? []).filter((k) => k !== key);
      const keptOverrides = Object.fromEntries(Object.entries(overrides ?? {}).filter(([k]) => k !== key));
      return { ...rest, ...(keptMissing.length ? { missing: keptMissing } : {}), ...(Object.keys(keptOverrides).length ? { overrides: keptOverrides } : {}) };
    }),
  };
}

/** Renaming a key follows it into missing and overrides. */
export function renameReading(map: PointMap, from: string, to: string): PointMap {
  const swap = (k: string) => (k === from ? to : k);
  return {
    ...map,
    readings: map.readings.map((r) => (r.key === from ? { ...r, key: to } : r)),
    equipment: map.equipment.map((e) => ({
      ...e,
      ...(e.missing ? { missing: e.missing.map(swap) } : {}),
      ...(e.overrides ? { overrides: Object.fromEntries(Object.entries(e.overrides).map(([k, v]) => [swap(k), v])) } : {}),
    })),
  };
}

export function pointCount(map: PointMap): number {
  return map.equipment.reduce((total, e) => total + map.readings.length - (e.missing ?? []).length, 0);
}

export function rowsPerDay(map: PointMap): number {
  return pointCount(map) * Math.ceil(86_400 / map.rhythm_seconds);
}

/** What the person can fix before asking the server (the review check repeats them). */
export function mapIssues(map: PointMap): { key: string | null; problem: string }[] {
  const issues: { key: string | null; problem: string }[] = [];
  const seen = new Set<string>();
  for (const reading of map.readings) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(reading.key)) issues.push({ key: reading.key, problem: "A key starts with a letter and has only letters, digits, dots, dashes and underscores." });
    if (seen.has(reading.key)) issues.push({ key: reading.key, problem: "Two readings have this key." });
    seen.add(reading.key);
    if (!reading.name.trim()) issues.push({ key: reading.key, problem: "Name the reading." });
    if (reading.data_type === "number" && !reading.unit?.trim()) issues.push({ key: reading.key, problem: "Give this number a unit, for example %, °C or count." });
    if (reading.report.sample_ms < FASTEST_SAMPLE_MS) issues.push({ key: reading.key, problem: "Sample at most once a second." });
  }
  if (!map.equipment.length) issues.push({ key: null, problem: "Pick the equipment to collect from." });
  return issues;
}

export function emptyMap(): PointMap {
  return { version: 1, protocol: "opcua", rhythm_seconds: DEFAULT_RHYTHM_SECONDS, readings: [], equipment: [] };
}
