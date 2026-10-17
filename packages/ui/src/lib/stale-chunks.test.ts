import { describe, expect, it } from "vitest"
import { isChunkLoadError, staleChunkReloadDue } from "./stale-chunks"

describe("stale chunks", () => {
  it("recognises a chunk that failed to load in each browser", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://example.com/assets/Routes-abc.js"))).toBe(true)
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://example.com/assets/Routes-abc.js"))).toBe(true)
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true)
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/Routes-abc.css"))).toBe(true)
  })

  it("leaves other errors alone", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of null (reading 'map')"))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError({ message: "Failed to fetch dynamically imported module" })).toBe(false)
  })

  it("reloads once, then not again within the cooldown", () => {
    const now = 1_000_000
    expect(staleChunkReloadDue(null, now)).toBe(true)
    expect(staleChunkReloadDue(now - 2_000, now)).toBe(false)
    expect(staleChunkReloadDue(now - 10_000, now)).toBe(true)
    expect(staleChunkReloadDue(Number.NaN, now)).toBe(true)
  })
})
