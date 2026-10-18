import * as React from "react"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"
import { CharacterCount, Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import {
  BoldIcon,
  CodeIcon,
  FileCodeIcon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
} from "lucide-react"

import { Button } from "@iot-os/ui/components/button"
import { Input } from "@iot-os/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@iot-os/ui/components/popover"
import { Separator } from "@iot-os/ui/components/separator"
import { Toggle } from "@iot-os/ui/components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@iot-os/ui/components/tooltip"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * The editable area, styled like `Markdown` renders the same text, so what you write
 * is what people read. The placeholder shows on an empty first paragraph.
 */
const contentClassName = cn(
  "min-h-24 max-h-96 w-full min-w-0 flex-1 overflow-y-auto px-2.5 py-2 text-base leading-relaxed wrap-break-word outline-none md:text-sm",
  "[&>*+*]:mt-2 [&_strong]:font-semibold [&_s]:text-muted-foreground",
  "[&_h1]:text-heading [&_h2]:text-heading [&_h3]:font-semibold",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:pl-0.5 [&_li+li]:mt-1 [&_li>p]:m-0",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-checked]]:flex [&_li[data-checked]]:items-start [&_li[data-checked]]:gap-2 [&_li[data-checked]>label]:pt-0.5 [&_li[data-checked]>div]:flex-1 [&_input[type=checkbox]]:accent-primary",
  "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-code",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-code [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-3 [&_hr]:border-border",
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
)

export type MarkdownEditorOptions = {
  /** Markdown in and out: the editor shows it formatted and reports Markdown on every change. */
  value: string
  onValueChange: (markdown: string) => void
  /** The accessible name of the editable area. */
  label: string
  id?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  /** Characters of text (not Markdown syntax) the editor accepts. */
  maxLength?: number
  /** Files pasted or dropped into the text, such as screenshots. */
  onFiles?: (files: File[]) => void
  /** Ctrl or ⌘ Enter. */
  onSubmitShortcut?: () => void
}

/**
 * A rich text editor that reads and writes Markdown (GitHub flavour: emphasis, strike,
 * code, links, lists, task lists, quotes, code blocks and small headings). Changes
 * from outside, such as clearing after sending, replace the content without echoing
 * back through `onValueChange`.
 */
export function useMarkdownEditor({
  value,
  onValueChange,
  label,
  id,
  placeholder = "",
  disabled = false,
  invalid = false,
  maxLength,
  onFiles,
  onSubmitShortcut,
}: MarkdownEditorOptions) {
  const callbacks = React.useRef({ onValueChange, onFiles, onSubmitShortcut, placeholder })
  callbacks.current = { onValueChange, onFiles, onSubmitShortcut, placeholder }
  // The Markdown the editor holds, so value updates it caused are not applied twice.
  const current = React.useRef(value)
  const attributes = React.useCallback(
    () => ({
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": label,
      "aria-invalid": invalid ? "true" : "false",
      "data-slot": "input-group-control",
      class: contentClassName,
      ...(id ? { id } : {}),
    }),
    [id, invalid, label],
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Markdown has no underline.
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      Placeholder.configure({ placeholder: () => callbacks.current.placeholder }),
      CharacterCount.configure({ limit: maxLength ?? null }),
    ],
    content: value,
    contentType: "markdown",
    editable: !disabled,
    editorProps: {
      attributes: attributes(),
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (files.length === 0 || !callbacks.current.onFiles) return false
        event.preventDefault()
        callbacks.current.onFiles(files)
        return true
      },
      handleDrop: (_view, event) => {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])]
        if (files.length === 0 || !callbacks.current.onFiles) return false
        event.preventDefault()
        // The composer also listens for drops around the editor; one is enough.
        event.stopPropagation()
        callbacks.current.onFiles(files)
        return true
      },
      handleKeyDown: (view, event) => {
        if (!(event.metaKey || event.ctrlKey) || event.isComposing) return false
        if (event.key.toLowerCase() === "k") {
          // Opens the toolbar's link editor, when the editor has a toolbar.
          const button = view.dom.closest("[data-slot=input-group]")?.querySelector<HTMLButtonElement>("[data-slot=markdown-toolbar] button[aria-label=Link]")
          if (!button || button.disabled) return false
          event.preventDefault()
          // In the text, ⌘K means link, not the app's command palette.
          event.stopPropagation()
          button.click()
          return true
        }
        if (event.key !== "Enter") return false
        event.preventDefault()
        callbacks.current.onSubmitShortcut?.()
        return true
      },
    },
    onUpdate: ({ editor }) => {
      // The serializer ends with blank lines; trailing whitespace carries no meaning.
      const markdown = editor.isEmpty ? "" : editor.getMarkdown().replace(/\s+$/, "")
      current.current = markdown
      callbacks.current.onValueChange(markdown)
    },
  })

  React.useEffect(() => {
    if (!editor || value === current.current) return
    current.current = value
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false })
  }, [editor, value])

  React.useEffect(() => {
    editor?.setEditable(!disabled, false)
  }, [editor, disabled])

  React.useEffect(() => {
    if (!editor) return
    editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: attributes() } })
  }, [editor, attributes])

  // Redraw the placeholder when it changes.
  React.useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr)
  }, [editor, placeholder])

  return editor
}

/** The editable area of a `useMarkdownEditor` editor. */
export function MarkdownEditorContent({ editor, className }: { editor: Editor | null; className?: string }) {
  // The input group centres its children; the editor takes the full width.
  return <EditorContent editor={editor} data-slot="markdown-editor" className={cn("flex w-full min-w-0 flex-1 self-stretch", className)} />
}

function ToolbarButton({
  label,
  shortcut,
  pressed,
  disabled,
  onPressed,
  children,
}: {
  label: string
  shortcut?: string
  pressed: boolean
  disabled?: boolean
  onPressed: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          aria-label={label}
          pressed={pressed}
          disabled={disabled}
          // Keep the text selection while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onPressedChange={onPressed}
          className="text-muted-foreground"
        >
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="ml-1.5 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"

function LinkButton({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [href, setHref] = React.useState("")
  const active = useEditorState({ editor, selector: ({ editor }) => editor.isActive("link") })
  const apply = (event: React.FormEvent) => {
    event.preventDefault()
    // The popover is portaled, but React still bubbles its submit to the composer's form.
    event.stopPropagation()
    const url = href.trim()
    const chain = editor.chain().focus().extendMarkRange("link")
    if (url === "") chain.unsetLink().run()
    else chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` }).run()
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setHref((editor.getAttributes("link").href as string | undefined) ?? "")
        setOpen(next)
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Toggle size="sm" aria-label="Link" pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} className="text-muted-foreground">
              <LinkIcon />
            </Toggle>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Link<span className="ml-1.5 text-muted-foreground">{mod}K</span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-80 p-3"
        // Back to the text, not the Link button, which the Enter key-up would press again.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          editor.commands.focus()
        }}
      >
        <form className="flex items-center gap-2" onSubmit={apply}>
          <Input aria-label="Link address" placeholder="https://example.com" value={href} autoFocus onChange={(event) => setHref(event.target.value)} />
          <Button type="submit" size="sm">
            {href.trim() || !active ? "Apply" : "Remove"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Formatting buttons for a `useMarkdownEditor` editor, plus a switch to edit the
 * Markdown itself. Each button reflects the formatting at the cursor.
 */
export function MarkdownToolbar({
  editor,
  source = false,
  onSourceChange,
  disabled = false,
  className,
}: {
  editor: Editor | null
  /** Editing the raw Markdown instead of the formatted text. */
  source?: boolean
  onSourceChange?: (source: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            strike: editor.isActive("strike"),
            code: editor.isActive("code"),
            heading: editor.isActive("heading", { level: 3 }),
            bulletList: editor.isActive("bulletList"),
            orderedList: editor.isActive("orderedList"),
            taskList: editor.isActive("taskList"),
            blockquote: editor.isActive("blockquote"),
            codeBlock: editor.isActive("codeBlock"),
          }
        : null,
  })
  if (!editor || !state) return null
  const off = disabled || source
  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => command(editor.chain().focus()).run()
  return (
    <div role="toolbar" aria-label="Formatting" data-slot="markdown-toolbar" className={cn("flex flex-wrap items-center gap-0.5", className)}>
      <ToolbarButton label="Bold" shortcut={`${mod}B`} pressed={state.bold} disabled={off} onPressed={run((c) => c.toggleBold())}>
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton label="Italic" shortcut={`${mod}I`} pressed={state.italic} disabled={off} onPressed={run((c) => c.toggleItalic())}>
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" pressed={state.strike} disabled={off} onPressed={run((c) => c.toggleStrike())}>
        <StrikethroughIcon />
      </ToolbarButton>
      <ToolbarButton label="Inline code" pressed={state.code} disabled={off} onPressed={run((c) => c.toggleCode())}>
        <CodeIcon />
      </ToolbarButton>
      <LinkButton editor={editor} disabled={off} />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <ToolbarButton label="Heading" pressed={state.heading} disabled={off} onPressed={run((c) => c.toggleHeading({ level: 3 }))}>
        <Heading3Icon />
      </ToolbarButton>
      <ToolbarButton label="Bulleted list" pressed={state.bulletList} disabled={off} onPressed={run((c) => c.toggleBulletList())}>
        <ListIcon />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" pressed={state.orderedList} disabled={off} onPressed={run((c) => c.toggleOrderedList())}>
        <ListOrderedIcon />
      </ToolbarButton>
      <ToolbarButton label="Checklist" pressed={state.taskList} disabled={off} onPressed={run((c) => c.toggleTaskList())}>
        <ListChecksIcon />
      </ToolbarButton>
      <ToolbarButton label="Quote" pressed={state.blockquote} disabled={off} onPressed={run((c) => c.toggleBlockquote())}>
        <QuoteIcon />
      </ToolbarButton>
      <ToolbarButton label="Code block" pressed={state.codeBlock} disabled={off} onPressed={run((c) => c.toggleCodeBlock())}>
        <SquareCodeIcon />
      </ToolbarButton>
      {onSourceChange && (
        <>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <ToolbarButton label={source ? "Back to formatted text" : "Edit as Markdown"} pressed={source} disabled={disabled} onPressed={() => onSourceChange(!source)}>
            <FileCodeIcon />
          </ToolbarButton>
        </>
      )}
    </div>
  )
}
