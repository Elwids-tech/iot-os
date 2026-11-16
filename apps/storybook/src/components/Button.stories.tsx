import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Input } from "@iot-os/ui/components/input"
import { Label } from "@iot-os/ui/components/label"

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  args: { children: "Add device" },
}
export default meta

export const Playground: StoryObj<typeof Button> = {}

/** One primary action per page header. "New" for things you author, "Add" for things that exist, "Invite" for people. */
export const Variants: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button><PlusIcon />Add device</Button>
      <Button variant="outline">Add to dashboard</Button>
      <Button variant="secondary">Validate</Button>
      <Button variant="ghost">Edit</Button>
      <Button variant="destructive"><Trash2Icon />Delete</Button>
      <Button variant="link">All alerts</Button>
    </div>
  ),
}

export const Sizes: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

/**
 * Phones (under 768 px): every size and the text field are at least 44 px tall, icon
 * buttons 44 px square, and the field's text is 16 px so iOS does not zoom in on focus.
 * Link buttons inside a sentence keep the line's height.
 */
export const Phone: StoryObj = {
  globals: { viewport: { value: "phone", isRotated: false } },
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="icon-sm" variant="outline" aria-label="Add device"><PlusIcon /></Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="story-phone-search">Device name</Label>
        <Input id="story-phone-search" placeholder="Search name or code" />
      </div>
      <p className="text-body text-muted-foreground">
        Archived devices hidden. <Button variant="link" className="h-auto p-0">Show them</Button>
      </p>
    </div>
  ),
}

/** The same controls from 768 px: unchanged desktop sizes. */
export const Computer: StoryObj = {
  ...Phone,
  globals: { viewport: { value: "computer", isRotated: false } },
}
