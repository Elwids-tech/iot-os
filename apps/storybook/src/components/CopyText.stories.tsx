import type { Meta, StoryObj } from "@storybook/react-vite"
import { CopyButton, CopyText } from "@iot-os/ui/components/copy-text"

const meta: Meta<typeof CopyText> = { title: "Components/CopyText", component: CopyText }
export default meta

/**
 * Identifiers people paste elsewhere copy with one click. Plain text copies itself and shows a
 * check; a name that is already a link gets a copy button beside it. The full value shows on
 * hover even when a shorter form is displayed.
 */
export const States: StoryObj = {
  render: () => (
    <dl className="grid max-w-md grid-cols-[10rem_1fr] items-center gap-y-3 text-body">
      <dt className="text-muted-foreground">Code</dt>
      <dd><CopyText value="boiler-room-01" label="device code" mono /></dd>
      <dt className="text-muted-foreground">Shortened</dt>
      <dd>
        <CopyText value="device-7f3c2a9e-1b44-4c1d-9a51-2f0e6c1d88b0" label="device code" mono>
          device-7f3c…88b0
        </CopyText>
      </dd>
      <dt className="text-muted-foreground">Beside a link</dt>
      <dd className="flex items-center gap-1">
        <a href="#device" className="font-medium underline-offset-4 hover:underline">Boiler room sensor</a>
        <CopyButton value="Boiler room sensor" label="device name" />
      </dd>
    </dl>
  ),
}
