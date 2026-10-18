import { describe, expect, it } from "vitest"
import { cn } from "./utils"

describe("cn", () => {
  it("keeps a named size next to a text colour", () => {
    expect(cn("text-meta text-muted-foreground")).toBe("text-meta text-muted-foreground")
    expect(cn("text-primary", "text-micro")).toBe("text-primary text-micro")
  })

  it("keeps the last font size", () => {
    expect(cn("text-body", "text-meta")).toBe("text-meta")
    expect(cn("text-sm", "text-heading")).toBe("text-heading")
    expect(cn("text-title", "text-xs")).toBe("text-xs")
  })

  it("still merges colours", () => {
    expect(cn("text-meta text-muted-foreground", "text-foreground")).toBe("text-meta text-foreground")
  })
})
