import * as React from "react"
import { FileTextIcon, PaperclipIcon, SendIcon, XIcon } from "lucide-react"

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@iot-os/ui/components/attachment"
import { Button } from "@iot-os/ui/components/button"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@iot-os/ui/components/input-group"
import { formatBytes } from "@iot-os/ui/components/thread"
import { cn } from "@iot-os/ui/lib/utils"

export type ComposerFile = {
  id: string
  file: File
  /** Why the file cannot be sent; such files block sending until removed. */
  error?: string
}

const typeNames: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "application/pdf": "PDF",
}

/** "PNG, JPEG, WebP or PDF". */
function describeTypes(accept: string[]) {
  const names = accept.map((type) => typeNames[type] ?? type)
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0]
}

/**
 * Checks new files against the accepted types, the size limit and the number of
 * files, and gives pasted screenshots a readable name.
 */
export function prepareFiles(
  incoming: File[],
  current: ComposerFile[],
  { accept, maxFiles, maxBytes }: { accept: string[]; maxFiles: number; maxBytes: number },
): ComposerFile[] {
  let room = maxFiles - current.filter((entry) => !entry.error).length
  return incoming.map((original, index) => {
    const pasted = original.name === "" || original.name === "image.png"
    const file = pasted
      ? new File([original], `Pasted image ${new Date().toLocaleTimeString().replaceAll(":", ".")}${index ? ` ${index + 1}` : ""}.png`, { type: original.type })
      : original
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (!accept.includes(file.type)) return { id, file, error: `Use a ${describeTypes(accept)} file.` }
    if (file.size > maxBytes) return { id, file, error: `Larger than ${formatBytes(maxBytes)}.` }
    if (room <= 0) return { id, file, error: `Up to ${maxFiles} files per message.` }
    room -= 1
    return { id, file }
  })
}

/**
 * A Markdown message box with file attachments: attach, drop or paste images and
 * PDFs. Enter starts a new line; Ctrl or ⌘ Enter sends. `controls` sit next to the
 * send button (for example a "reply or note" switch). Inside a larger form, pass
 * `field` to leave out the form element and the send button.
 */
function Composer({
  value,
  onValueChange,
  files,
  onFilesChange,
  onSubmit,
  pending = false,
  field = false,
  id,
  disabled = false,
  label,
  placeholder,
  submitLabel = "Send",
  hint = "Markdown supported",
  controls,
  accept = ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  maxFiles = 5,
  maxBytes = 10 * 1024 * 1024,
  maxLength = 10000,
  invalid = false,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  files: ComposerFile[]
  onFilesChange: (files: ComposerFile[]) => void
  onSubmit?: () => void
  pending?: boolean
  field?: boolean
  id?: string
  disabled?: boolean
  label: string
  placeholder?: string
  submitLabel?: string
  hint?: React.ReactNode
  controls?: React.ReactNode
  accept?: string[]
  maxFiles?: number
  maxBytes?: number
  maxLength?: number
  invalid?: boolean
  className?: string
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const previews = React.useMemo(
    () => new Map(files.filter((entry) => entry.file.type.startsWith("image/")).map((entry) => [entry.id, URL.createObjectURL(entry.file)])),
    [files],
  )
  React.useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const add = (incoming: File[]) => {
    if (incoming.length && !disabled) onFilesChange([...files, ...prepareFiles(incoming, files, { accept, maxFiles, maxBytes })])
  }
  const blocked = files.some((entry) => entry.error)
  const empty = !value.trim() && files.length === 0
  const canSubmit = !pending && !disabled && !blocked && !empty && !!onSubmit
  const Root = field ? "div" : "form"

  return (
    <Root
      data-slot="composer"
      data-dragging={dragging || undefined}
      className={cn("flex min-w-0 flex-col gap-2", className)}
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault()
        if (canSubmit) onSubmit?.()
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        setDragging(false)
        add([...event.dataTransfer.files])
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={accept.join(",")}
        disabled={disabled}
        onChange={(event) => {
          add([...(event.target.files ?? [])])
          event.target.value = ""
        }}
      />
      <InputGroup className={cn(dragging && "border-ring ring-3 ring-ring/50")}>
        <InputGroupTextarea
          id={id}
          aria-label={label}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          value={value}
          rows={4}
          maxLength={maxLength}
          disabled={disabled}
          className="max-h-96"
          onChange={(event) => onValueChange(event.target.value)}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files]
            if (pasted.length === 0) return
            event.preventDefault()
            add(pasted)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (canSubmit) onSubmit?.()
            }
          }}
        />
        {files.length > 0 && (
          <InputGroupAddon align="block-end" className="cursor-default">
            <AttachmentGroup className="w-full">
              {files.map((entry) => {
                const preview = previews.get(entry.id)
                return (
                  <Attachment key={entry.id} size="sm" state={entry.error ? "error" : "done"}>
                    <AttachmentMedia variant={preview && !entry.error ? "image" : "icon"}>
                      {preview && !entry.error ? <img src={preview} alt="" /> : <FileTextIcon />}
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle title={entry.file.name}>{entry.file.name}</AttachmentTitle>
                      <AttachmentDescription>{entry.error ?? formatBytes(entry.file.size)}</AttachmentDescription>
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction
                        aria-label={`Remove ${entry.file.name}`}
                        disabled={pending}
                        onClick={() => onFilesChange(files.filter((other) => other.id !== entry.id))}
                      >
                        <XIcon />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                )
              })}
            </AttachmentGroup>
          </InputGroupAddon>
        )}
        <InputGroupAddon align="block-end">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Attach files"
            disabled={disabled || pending}
            onClick={() => input.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <span className="mr-auto truncate text-meta text-muted-foreground">
            {dragging ? "Drop to attach" : hint}
          </span>
          {controls}
          {!field && (
            <Button type="submit" size="sm" disabled={!canSubmit}>
              <SendIcon data-icon="inline-start" />
              {pending ? "Sending…" : submitLabel}
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </Root>
  )
}

export { Composer }
