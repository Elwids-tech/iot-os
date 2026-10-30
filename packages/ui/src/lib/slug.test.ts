import { describe, expect, it } from "vitest"
import { slugify } from "./slug"

describe("slugify", () => {
  it("joins words with single dashes", () => {
    expect(slugify("Corner Shop")).toBe("corner-shop")
    expect(slugify("  Harbour   Depot  ")).toBe("harbour-depot")
  })

  it("turns punctuation into dashes and trims them at the ends", () => {
    expect(slugify("Smith & Sons, Ltd.")).toBe("smith-sons-ltd")
    expect(slugify("--North/South--")).toBe("north-south")
  })

  it("drops accented letters instead of folding them", () => {
    expect(slugify("Lakeside Café")).toBe("lakeside-caf")
  })

  it("returns an empty string when nothing is left", () => {
    expect(slugify("¿¿¿")).toBe("")
    expect(slugify("")).toBe("")
  })
})
