import type { Meta, StoryObj } from "@storybook/react-vite"
import { Thinking } from "@iot-os/ui/components/thinking"
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble"
import { Message, MessageContent, MessageHeader } from "@iot-os/ui/components/message"

const meta: Meta<typeof Thinking> = { title: "Components/Thinking", component: Thinking }
export default meta

/**
 * Shown in place of a reply while the assistant works. The label says what it
 * is doing; after ten seconds the elapsed time appears. With reduced motion the
 * dots and the shimmer hold still.
 */
export const InAChat: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <Message align="end">
        <MessageContent>
          <MessageHeader>You</MessageHeader>
          <Bubble align="end">
            <BubbleContent>Turn on the alarm when the tracker leaves the yard.</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          <MessageHeader>Automation assistant</MessageHeader>
          <Thinking />
        </MessageContent>
      </Message>
    </div>
  ),
}

/** Labels follow the run: sending, queued, then working. */
export const Labels: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Thinking>Sending…</Thinking>
      <Thinking>Waiting for the assistant…</Thinking>
      <Thinking>Reading the recorded evidence…</Thinking>
    </div>
  ),
}
