import { useEffect, useRef } from "react"
import { openSearchPanel } from "@codemirror/search"
import { basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { json } from "@codemirror/lang-json"
import { javascript } from "@codemirror/lang-javascript"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"

const colors = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--json-key)" },
  { tag: tags.string, color: "var(--json-string)" },
  { tag: tags.number, color: "var(--json-number)" },
  { tag: [tags.bool, tags.null], color: "var(--json-keyword)" },
])
const theme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    height: "100%",
    fontSize: "13px",
  },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--accent)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "var(--accent)" },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    padding: "8px",
  },
  ".cm-textfield": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--input)",
    borderRadius: "6px",
    padding: "5px 8px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
    border: "1px solid var(--input)",
    borderRadius: "6px",
    padding: "4px 8px",
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    whiteSpace: "nowrap",
  },
  ".cm-textfield:focus-visible, .cm-button:focus-visible": {
    outline: "2px solid var(--ring)",
    outlineOffset: "2px",
  },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)" },
})
export default function JsonCode({
  value,
  onChange,
  readOnly,
  label,
  searchRequest = 0,
  language = "json",
}: {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  label: string
  searchRequest?: number
  language?: "json" | "javascript"
}) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          language === "javascript" ? javascript() : json(),
          theme,
          syntaxHighlighting(colors),
          EditorView.lineWrapping,
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-readonly": String(Boolean(readOnly)),
            "aria-multiline": "true",
            role: "textbox",
            tabindex: "0",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              onChangeRef.current?.(update.state.doc.toString())
          }),
        ],
      }),
    })
    editor.current = view
    return () => {
      editor.current = null
      view.destroy()
    }
    // Only recreate when editing permissions or the accessible identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, label, language])
  useEffect(() => {
    const view = editor.current
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      })
  }, [value])
  useEffect(() => {
    if (searchRequest && editor.current) openSearchPanel(editor.current)
  }, [searchRequest])
  return <div ref={container} className="h-full min-w-0" />
}
