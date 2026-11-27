import { describe, expect, it } from "vitest";
import type { OpcuaNode, PointMap, SuggestedReading } from "@iot-os/api-client";
import { addEquipment, emptyMap, equipmentOf, mapIssues, pointCount, readingAt, removeReading, renameReading, rowsPerDay, tagPattern, tagPrefix, templateEquipment, type Template } from "./model";

const NS = "urn:example:bms:example-tower";
const node = (node_id: string, name: string, kind: OpcuaNode["kind"] = "point"): OpcuaNode => ({ node_id, namespace_uri: NS, name, display_name: name, kind, has_children: kind !== "point" });
const path = (...names: string[]) => names.map((name) => ({ namespace_uri: NS, name }));
const suggested = (key: string, unit: string | null = "°C"): SuggestedReading => ({ key, name: key, data_type: "number", unit, report: { sample_ms: 10000, deadband: { kind: "none", value: 0 } } });

describe("point map editing", () => {
  it("names the equipment and its readings by path in a tree", () => {
    const template: Template = { kind: "node", node: node("s=L03-VAV-2", "L03-VAV-2", "object"), path: path("Example Tower", "L03-VAV-2") };
    expect(templateEquipment(template)).toEqual({ source_id: "Example Tower/L03-VAV-2", display_name: "L03-VAV-2", address: { node_id: "s=L03-VAV-2", namespace_uri: NS, path: path("Example Tower", "L03-VAV-2") } });
    const reading = readingAt(suggested("zone_temperature"), { node: node("s=L03-VAV-2.zone_temperature", "zone_temperature"), name: "zone_temperature" }, template);
    expect(reading.address).toEqual({ relative_path: [{ namespace_uri: NS, name: "zone_temperature" }] });
    expect([reading.scale, reading.offset, reading.unit]).toEqual([1, 0, "°C"]);
    expect(readingAt({ ...suggested("occupancy"), data_type: "boolean", unit: undefined as unknown as null }, { node: node("s=x", "occupancy"), name: "occupancy" }, template).unit).toBeNull();
  });

  it("turns flat tags into patterns around the equipment prefix", () => {
    expect(tagPrefix(["ET_L03_VAV_2.ZN-T", "ET_L03_VAV_2.ZN-SP", "ET_L03_VAV_2.DMP-POS"])).toBe("ET_L03_VAV_2");
    expect(tagPrefix(["ET_L03_VAV_2.ZN-T"])).toBe("ET_L03_VAV_2");
    expect(tagPrefix([])).toBe("");
    expect(tagPattern("ET_L03_VAV_2.ZN-T", "ET_L03_VAV_2")).toBe("{equipment}.ZN-T");
    expect(tagPattern("ET_L02_VAV_1.ZN-T", "ET_L03_VAV_2")).toBeNull();
    const template: Template = { kind: "tags", folder: path("Example Tower tags"), prefix: "ET_L03_VAV_2", namespace_uri: NS };
    expect(templateEquipment(template)).toEqual({ source_id: "Example Tower tags/ET_L03_VAV_2", display_name: "ET_L03_VAV_2", address: { namespace_uri: NS, path: path("Example Tower tags", "ET_L03_VAV_2") } });
    expect(readingAt(suggested("zone_temperature"), { node: node("s=ET_L03_VAV_2.ZN-T", "ET_L03_VAV_2.ZN-T"), name: "ET_L03_VAV_2.ZN-T" }, template).address).toEqual({ relative_path: [{ namespace_uri: NS, pattern: "{equipment}.ZN-T" }] });
  });

  it("adds similar equipment once, keeping what each lacks", () => {
    const first = { source_id: "T/L03-VAV-2", display_name: "L03-VAV-2", address: { node_id: "s=L03-VAV-2", namespace_uri: NS, path: path("T", "L03-VAV-2") } };
    const flat = equipmentOf({ source_id: "Tags/ET_L02_VAV_1", display_name: "ET_L02_VAV_1", address: { node_id: null, namespace_uri: null, path: [{ namespace_uri: null, name: "Tags" }, { namespace_uri: null, name: "ET_L02_VAV_1" }] }, missing: ["zone_co2"] }, NS);
    expect(flat).toEqual({ source_id: "Tags/ET_L02_VAV_1", display_name: "ET_L02_VAV_1", address: { namespace_uri: NS, path: path("Tags", "ET_L02_VAV_1") }, missing: ["zone_co2"] });
    expect(addEquipment([first], [first, flat]).map((e) => e.source_id)).toEqual(["T/L03-VAV-2", "Tags/ET_L02_VAV_1"]);
  });

  it("renames and removes readings everywhere they are named", () => {
    const map: PointMap = {
      ...emptyMap(),
      readings: [readingAt(suggested("zone_temperature"), { node: node("s=a", "a"), name: "a" }, { kind: "node", node: node("s=e", "e", "object"), path: path("e") }), readingAt(suggested("zone_co2", "ppm"), { node: node("s=b", "b"), name: "b" }, { kind: "node", node: node("s=e", "e", "object"), path: path("e") })],
      equipment: [{ source_id: "e", display_name: "e", address: { namespace_uri: NS, path: path("e") }, missing: ["zone_co2"], overrides: { zone_temperature: { node_id: "s=x", namespace_uri: NS } } }],
    };
    expect(renameReading(map, "zone_temperature", "temperature").equipment[0].overrides).toEqual({ temperature: { node_id: "s=x", namespace_uri: NS } });
    const removed = removeReading(map, "zone_co2");
    expect(removed.readings.map((r) => r.key)).toEqual(["zone_temperature"]);
    expect(removed.equipment[0].missing).toBeUndefined();
    expect(pointCount(map)).toBe(1);
    expect(rowsPerDay(map)).toBe(288);
  });

  it("finds what to fix before asking the server", () => {
    const map: PointMap = { ...emptyMap(), readings: [{ ...readingAt(suggested("1bad", null), { node: node("s=a", "a"), name: "a" }, { kind: "node", node: node("s=e", "e", "object"), path: path("e") }) }] };
    expect(mapIssues(map).map((i) => i.problem)).toEqual([
      "A key starts with a letter and has only letters, digits, dots, dashes and underscores.",
      "Give this number a unit, for example %, °C or count.",
      "Pick the equipment to collect from.",
    ]);
  });
});
