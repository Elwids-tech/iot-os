import type { Meta, StoryObj } from "@storybook/react-vite"
import { ColorMark } from "@iot-os/ui/components/color-mark"

const meta: Meta<typeof ColorMark> = { title: "Components/ColorMark", component: ColorMark }
export default meta

/**
 * The one colour key of the kit: a small square with rounded corners. Status
 * marks, chart legends, state bands and unread markers all use it, always
 * next to words.
 */
export const Keys: StoryObj = {
  render: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-meta text-muted-foreground">
      <li className="inline-flex items-center gap-1.5"><ColorMark className="bg-primary" />On</li>
      <li className="inline-flex items-center gap-1.5"><ColorMark className="bg-muted-foreground/25" />Off</li>
      <li className="inline-flex items-center gap-1.5"><ColorMark className="bg-destructive" />Alert raised</li>
      <li className="inline-flex items-center gap-1.5"><ColorMark className="border border-dashed border-muted-foreground/70" />No fresh reading</li>
      <li className="inline-flex items-center gap-1.5"><ColorMark color="var(--series-1)" />A computed colour</li>
    </ul>
  ),
}

/** Smaller beside dense text, larger beside a band chart. */
export const Sizes: StoryObj = {
  render: () => (
    <div className="flex items-center gap-4 text-body">
      <span className="inline-flex items-center gap-1.5"><ColorMark className="size-2 bg-success" />8 px</span>
      <span className="inline-flex items-center gap-1.5"><ColorMark className="bg-success" />10 px, the default</span>
      <span className="inline-flex items-center gap-1.5"><ColorMark className="size-3 bg-success" />12 px</span>
    </div>
  ),
}
