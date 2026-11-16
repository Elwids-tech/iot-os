import type { Meta, StoryObj } from "@storybook/react-vite"
import { OfflineScreen } from "@iot-os/ui/components/offline-screen"

const meta: Meta<typeof OfflineScreen> = {
  title: "Components/OfflineScreen",
  component: OfflineScreen,
  parameters: { layout: "fullscreen" },
}
export default meta

/** What an installed app shows when it opens without a connection: no earlier data, only a way to try again. */
export const Default: StoryObj<typeof OfflineScreen> = {
  args: { onRetry: () => {} },
}

/** While **Try again** checks the connection. */
export const Retrying: StoryObj<typeof OfflineScreen> = {
  args: { onRetry: () => {}, retrying: true },
}
