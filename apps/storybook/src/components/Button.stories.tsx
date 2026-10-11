import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"

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
