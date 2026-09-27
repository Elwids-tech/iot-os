import { describe, expect, it } from "vitest"
import {
  objectValue,
  readValidation,
  updateConfig,
  validationRule,
  rangeRule,
  isArithmetic,
  validationSummary,
  ruleLabel,
  formulaText,
  fieldChanges,
} from "./authoring"
describe("lossless guided authoring", () => {
  it("summarizes guided rules without changing them", () => {
    expect(validationSummary({ mode: "range", min: 0, max: 480 })).toBe(
      "Allow values at least 0 and at most 480 (inclusive).",
    )
    expect(validationSummary({ mode: "options", options: [] })).toContain(
      "accepts no values",
    )
    expect(
      validationSummary({
        mode: "conditions",
        join: "or",
        conditions: [{ operator: "===", value: "blink" }],
      }),
    ).toContain('At least one must match: value equals (same type) "blink"')
  })
  it("keeps unknown keys when a guided control changes", () => {
    const input = JSON.stringify({
      precision: 2,
      vendor: { nested: { keep: true } },
      widget: "number",
    })
    expect(objectValue(updateConfig(input, "precision", 3))).toEqual({
      precision: 3,
      vendor: { nested: { keep: true } },
      widget: "number",
    })
  })
  it("only removes the explicitly cleared field", () => {
    expect(
      objectValue(
        updateConfig('{"precision":2,"vendor":42}', "precision", undefined),
      ),
    ).toEqual({ vendor: 42 })
  })
  it("never turns invalid JSON into a default object", () => {
    expect(() => updateConfig("{bad", "precision", 2)).toThrow()
    expect(() => objectValue("[1,2]")).toThrow()
  })
  it("recognizes exact ranges and preserves diagnostic metadata", () => {
    const text = validationRule(
      '{"vendor":{"keep":true},"diagnostic_code":"stable","message":"Keep this"}',
      rangeRule(1, 10),
    )
    expect(readValidation(text)).toEqual({ mode: "range", min: 1, max: 10 })
    expect(objectValue(text)?.vendor).toEqual({ keep: true })
    expect(objectValue(text)?.diagnostic_code).toBe("stable")
  })
  it("does not simplify nested or unfamiliar rules", () => {
    const nested = JSON.stringify({
      engine: "json_logic",
      rule: {
        and: [
          { ">=": [{ var: "value" }, 0] },
          {
            or: [
              { "===": [{ var: "previous_value" }, null] },
              { ">=": [{ var: "value" }, { var: "previous_value" }] },
            ],
          },
        ],
      },
      diagnostic_code: "counter",
      message: "Counter",
    })
    expect(readValidation(nested)).toEqual({ mode: "custom" })
    expect(
      readValidation('{"engine":"other","rule":{">=":[{"var":"value"},0]}}'),
    ).toEqual({ mode: "custom" })
  })
  it("retains typed enum values", () => {
    expect(
      readValidation(
        validationRule("null", { in: [{ var: "value" }, [1, 2, true]] }),
      ),
    ).toEqual({ mode: "options", options: [1, 2, true] })
  })
  it("only opens arithmetic trees the builder can represent", () => {
    expect(
      isArithmetic({ "/": [{ "+": [{ var: "a" }, { var: "b" }, 2] }, 3] }),
    ).toBe(true)
    expect(isArithmetic({ and: [true, false] })).toBe(false)
    expect(isArithmetic({ var: ["a", 0] })).toBe(false)
  })
})
describe("review and table labels", () => {
  it("shortens rules and formulas", () => {
    expect(ruleLabel({ mode: "range", min: 0, max: 480 })).toBe(
      "Between 0 and 480",
    )
    expect(ruleLabel({ mode: "options", options: ["a"] })).toBe(
      "1 allowed value",
    )
    expect(
      formulaText({ "/": [{ "+": [{ var: "l1" }, { var: "l2" }] }, 2] }),
    ).toBe("(l1 + l2) / 2")
    expect(formulaText({ max: [1, 2] })).toBeNull()
  })
  it("lists changed fields, one level into settings objects", () => {
    const rows = fieldChanges([
      {
        area: "parameters",
        label: "Voltage",
        change: "Updated",
        before: { uuid: "p", unit: "V", display: { precision: 1, widget: "number" } },
        after: { uuid: "p", unit: "kV", display: { precision: 2, widget: "number" } },
      },
      { area: "parameters", label: "Current", change: "Added", after: { uuid: "c" } },
    ])
    expect(rows.map((row) => [row.item, row.field, row.before, row.after])).toEqual([
      ["Voltage", "Stored unit", "V", "kV"],
      ["Voltage", "Decimals", "1", "2"],
      ["Current", "Added", "", ""],
    ])
  })
})
