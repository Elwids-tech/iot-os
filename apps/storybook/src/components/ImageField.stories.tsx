import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { FieldGroup } from "@iot-os/ui/components/field"
import { ImageField } from "@iot-os/ui/components/image-field"

const meta: Meta<typeof ImageField> = { title: "Components/ImageField", component: ImageField }
export default meta

const accept = ["image/png", "image/jpeg", "image/webp"]

/**
 * One image of a form. Picking a file saves it at once; a file of the wrong type or over
 * the size is refused before anything is sent, and a refusal from the server shows under
 * the field. The dark logo previews on the dark surface it is shown on.
 */
export const States: StoryObj = {
  render: function Render() {
    const [logo, setLogo] = useState<{ url: string } | null>(null)
    const [icon, setIcon] = useState<{ url: string } | null>(null)
    return (
      <FieldGroup className="max-w-form">
        <ImageField
          id="story-logo"
          label="Logo"
          description="Shown in the sidebar and on the sign-in page."
          value={logo}
          accept={accept}
          maxBytes={1048576}
          onSelect={(file) => setLogo({ url: URL.createObjectURL(file) })}
          onRemove={() => setLogo(null)}
        />
        <ImageField
          id="story-logo-dark"
          label="Logo for dark appearance"
          value={logo}
          accept={accept}
          maxBytes={1048576}
          surface="dark"
          onSelect={(file) => setLogo({ url: URL.createObjectURL(file) })}
          onRemove={() => setLogo(null)}
        />
        <ImageField
          id="story-icon"
          label="Icon"
          description="Square, at least 512 × 512 pixels."
          shape="square"
          value={icon}
          accept={accept}
          maxBytes={1048576}
          error={icon ? null : "The icon must be square."}
          onSelect={(file) => setIcon({ url: URL.createObjectURL(file) })}
          onRemove={() => setIcon(null)}
        />
        <ImageField id="story-busy" label="Uploading" value={null} accept={accept} maxBytes={1048576} busy onSelect={() => undefined} />
        <ImageField id="story-disabled" label="Read-only" value={null} accept={accept} maxBytes={1048576} disabled onSelect={() => undefined} />
      </FieldGroup>
    )
  },
}
