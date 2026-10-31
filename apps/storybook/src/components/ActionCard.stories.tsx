import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowRightIcon, FilePenLineIcon, PlugIcon, PowerIcon, RocketIcon } from "lucide-react"
import { ActionCard } from "@iot-os/ui/components/action-card"
import { Badge } from "@iot-os/ui/components/badge"
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble"
import { Button } from "@iot-os/ui/components/button"
import { Markdown } from "@iot-os/ui/components/markdown"
import { Message, MessageContent } from "@iot-os/ui/components/message"

const meta: Meta<typeof ActionCard> = { title: "Components/ActionCard", component: ActionCard }
export default meta

/**
 * A step that waits on the person in an assistant chat. The assistant proposes;
 * the person presses the button in the card. Replies are ghost bubbles without a
 * speaker label, and the person's own messages are tinted.
 */
export const InAChat: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="tinted">
            <BubbleContent>Here is a real message from WM-3001. Please create the adapter.</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          <Bubble variant="ghost">
            <BubbleContent>
              <Markdown>{"I tested the decoder with your sample: `WM-3001` → flow 12 L/min, total 8,400 L."}</Markdown>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <ActionCard
        icon={PlugIcon}
        label="Adapter proposal"
        title="Create the adapter “WM-300 meters”"
        description="Reads meters/+/telemetry and converts millilitres to litres."
      >
        <div className="flex w-full flex-wrap gap-1.5">
          <Badge variant="outline">Devices publish to our broker</Badge>
          <Badge variant="secondary">Decoder</Badge>
          <Badge variant="secondary">1 test sample</Badge>
        </div>
        <Button size="sm">Review</Button>
        <Button size="sm" variant="ghost">
          Dismiss
        </Button>
      </ActionCard>
    </div>
  ),
}

/** Each kind of step keeps its own icon and label. */
export const Kinds: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-3">
      <ActionCard
        icon={FilePenLineIcon}
        label="Device type proposal"
        title="Readings"
        description="Add flow rate (L/min) and total volume (L)."
      >
        <Button size="sm">Review section</Button>
      </ActionCard>
      <ActionCard
        icon={RocketIcon}
        label="Next step"
        title="Deploy"
        description="The decoder test passed. Deploy the adapter to start decoding live messages."
      >
        <Button size="sm">
          Deploy
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </ActionCard>
      <ActionCard
        icon={PowerIcon}
        label="Ready"
        title="A device is ready to activate"
        description="Activating maps every reading from the profile and starts storing them."
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="font-mono text-code">WM-3001</span>
          <Button size="sm">Activate</Button>
        </div>
      </ActionCard>
    </div>
  ),
}
