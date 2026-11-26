import { describe, expect, it } from "vitest"
import type { EntityType } from "@iot-os/api-client"
import { allowedTypes, endReasonText, entityLabel, impactLines, namingHint } from "./model"

const type = (key: string, rules: Partial<EntityType> = {}): EntityType => ({
  uuid: key,
  key,
  name: key[0]!.toUpperCase() + key.slice(1),
  top_level: false,
  parent_type_keys: [],
  member_type_keys: [],
  accepts_devices: true,
  carries_timezone: false,
  carries_location: false,
  naming: null,
  preset_keys: [],
  entities_count: 0,
  ...rules,
})

describe("hierarchy model", () => {
  const types = [
    type("site", { top_level: true }),
    type("area", { parent_type_keys: ["site"] }),
    type("line", { parent_type_keys: ["area"] }),
    type("building", { top_level: true, parent_type_keys: ["site"] }),
  ]

  it("offers only the types the parent allows, or top-level types without a parent", () => {
    expect(allowedTypes(types, null).map((t) => t.key)).toEqual(["site", "building"])
    expect(allowedTypes(types, { type: { key: "site" } }).map((t) => t.key)).toEqual(["area", "building"])
    expect(allowedTypes(types, { type: { key: "line" } })).toEqual([])
  })

  it("labels an entity with where it sits", () => {
    expect(entityLabel({ name: "Line 2", path: "RiversidePlant/Packaging/Line2" })).toBe("Line 2 · RiversidePlant/Packaging")
    expect(entityLabel({ name: "Riverside plant", path: "RiversidePlant" })).toBe("Riverside plant")
  })

  it("describes a naming template with its example and meaning", () => {
    expect(namingHint(type("feeder", { naming: { template: "Feeder<number>", example: "Feeder12", description: "Feeder and its number" } }))).toBe(
      "Names follow Feeder<number>, e.g. Feeder12: Feeder and its number.",
    )
    expect(namingHint(type("feeder", { naming: { template: "Feeder<number>", example: null, description: null } }))).toBe("Names follow Feeder<number>.")
    expect(namingHint(type("area"))).toBeUndefined()
  })

  it("says what a move changes before it happens", () => {
    expect(
      impactLines(
        {
          entities: 3,
          devices: 1,
          devices_changing_site: 1,
          devices_changing_timezone: 2,
          applications: [{ uuid: "a", name: "Twin viewer", gains: 0, loses: 1 }],
        },
        "Line 2",
      ),
    ).toEqual([
      "Line 2 and 2 entities below it get new paths.",
      "1 device moves with it.",
      "1 device changes site.",
      "2 devices change time zone: days and shifts start at a different hour from now on.",
      "Twin viewer loses 1 device.",
    ])
    expect(impactLines({ entities: 1, devices: 0, devices_changing_site: 0, devices_changing_timezone: 0, applications: [] }, "Zone B")).toEqual([
      "Zone B gets a new path.",
      "No devices are placed in it.",
    ])
  })
})

describe("endReasonText", () => {
  it("says why a placement or membership ended", () => {
    expect(endReasonText("moved_out")).toBe("moved to another organization")
    expect(endReasonText("replaced")).toBe("joined another group of that type")
    expect(endReasonText("something_new")).toBe("something new")
    expect(endReasonText(null)).toBeUndefined()
  })
})
