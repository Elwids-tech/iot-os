import { describe, expect, it } from "vitest"
import { assistantSessionIds, newEditorId } from "./assistant-session"

describe("assistant chat sessions", () => {
  it("gives each new-automation editor its own chat", () => {
    const first = newEditorId(), second = newEditorId()
    expect(first).not.toBe(second)
    expect(assistantSessionIds(first)).not.toEqual(assistantSessionIds(second))
  })
  it("keeps a chat with its editor after saving, and under the saved workflow", () => {
    const editor = newEditorId()
    expect(assistantSessionIds(editor, "workflow-1")).toEqual([editor, "workflow-1"])
    expect(assistantSessionIds("workflow-1", "workflow-1")).toEqual(["workflow-1"])
  })
  it("explains each evaluation in a separate chat", () => {
    expect(assistantSessionIds("workflow-1", "workflow-1", "17")).toEqual(["workflow-1:evaluation:17"])
  })
})
