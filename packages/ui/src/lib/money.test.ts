import { describe, expect, it } from "vitest"
import { currencyDigits, formatBasisPoints, formatMoney, moneyInput, parseBasisPoints, parseMoney } from "./money"

describe("money", () => {
  it("knows each currency's minor unit", () => {
    expect(currencyDigits("USD")).toBe(2)
    expect(currencyDigits("JPY")).toBe(0)
    expect(currencyDigits("not a currency")).toBe(2)
  })

  it("formats minor units in the reader's locale", () => {
    const usd = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD" })
    expect(formatMoney(2273, "USD")).toBe(usd(22.73))
    expect(formatMoney(-100, "USD")).toBe(usd(-1))
    expect(formatMoney(0, "USD")).toBe(usd(0))
    expect(formatMoney(1250, "JPY")).toBe((1250).toLocaleString(undefined, { style: "currency", currency: "JPY" }))
    expect(moneyInput(2273, "USD")).toBe("22.73")
    expect(moneyInput(5, "USD")).toBe("0.05")
  })

  it("parses what was typed into minor units", () => {
    expect(parseMoney("22.73", "USD")).toBe(2273)
    expect(parseMoney(" 1,250 ", "USD")).toBe(125000)
    expect(parseMoney("0.5", "USD")).toBe(50)
    expect(parseMoney("12.", "USD")).toBe(1200)
    expect(parseMoney("1.234", "USD")).toBeNull()
    expect(parseMoney("-1", "USD")).toBeNull()
    expect(parseMoney("-1", "USD", { signed: true })).toBe(-100)
    expect(parseMoney("", "USD")).toBeNull()
    expect(parseMoney("abc", "USD")).toBeNull()
    expect(parseMoney("1250", "JPY")).toBe(1250)
    expect(parseMoney("12.5", "JPY")).toBeNull()
  })

  it("reads tax rates as percentages", () => {
    expect(formatBasisPoints(1500)).toBe(`${(15).toLocaleString()}%`)
    expect(formatBasisPoints(825)).toBe(`${(8.25).toLocaleString()}%`)
    expect(parseBasisPoints("15")).toBe(1500)
    expect(parseBasisPoints("8.25")).toBe(825)
    expect(parseBasisPoints("8.5")).toBe(850)
    expect(parseBasisPoints("100")).toBe(10000)
    expect(parseBasisPoints("100.01")).toBeNull()
    expect(parseBasisPoints("8.255")).toBeNull()
    expect(parseBasisPoints("-1")).toBeNull()
  })
})
