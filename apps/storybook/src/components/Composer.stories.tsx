import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Composer, type ComposerFile } from "@iot-os/ui/components/composer"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"

const meta: Meta<typeof Composer> = { title: "Components/Composer", component: Composer }
export default meta

const png = new File([new Uint8Array([137, 80, 78, 71])], "devices-page.png", { type: "image/png" })
const zip = new File([new Uint8Array(12)], "logs.zip", { type: "application/zip" })

/**
 * A reply box: Markdown text plus images and PDFs that you attach, drop or paste.
 * Enter starts a new line and Ctrl or ⌘ Enter sends. A file that cannot be sent says
 * why and blocks sending until it is removed.
 */
export const Reply: StoryObj = {
  render: function Reply() {
    const [value, setValue] = useState("Serial 4411, firmware 2.1.")
    const [files, setFiles] = useState<ComposerFile[]>([
      { id: "a", file: png },
      { id: "b", file: zip, error: "Use a PNG, JPEG, WebP or PDF file." },
    ])
    return (
      <div className="max-w-2xl">
        <Composer
          label="Reply"
          placeholder="Write a reply…"
          value={value}
          onValueChange={setValue}
          files={files}
          onFilesChange={setFiles}
          onSubmit={() => {
            setValue("")
            setFiles([])
          }}
        />
      </div>
    )
  },
}

/** The team's version: a switch between a reply and an internal note sits by Send. */
export const WithControls: StoryObj = {
  render: function WithControls() {
    const [value, setValue] = useState("")
    const [files, setFiles] = useState<ComposerFile[]>([])
    const [kind, setKind] = useState("reply")
    return (
      <div className="max-w-2xl">
        <Composer
          label={kind === "note" ? "Internal note" : "Reply"}
          placeholder={kind === "note" ? "Only the team sees notes…" : "Write a reply…"}
          submitLabel={kind === "note" ? "Add note" : "Send reply"}
          value={value}
          onValueChange={setValue}
          files={files}
          onFilesChange={setFiles}
          onSubmit={() => setValue("")}
          controls={
            <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={kind} onValueChange={(next) => next && setKind(next)} aria-label="Message kind">
              <ToggleGroupItem value="reply">Reply</ToggleGroupItem>
              <ToggleGroupItem value="note">Internal note</ToggleGroupItem>
            </ToggleGroup>
          }
        />
      </div>
    )
  },
}
