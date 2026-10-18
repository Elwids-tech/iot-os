import type { Meta, StoryObj } from "@storybook/react-vite"
import { Markdown } from "@iot-os/ui/components/markdown"
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble"
import { Message, MessageContent, MessageHeader } from "@iot-os/ui/components/message"

const meta: Meta<typeof Markdown> = { title: "Components/Markdown", component: Markdown }
export default meta

const reply = `Deployment **generation 4** (draft revision 7) ran when the tracker reported a new position.

- The tracker was **inside** GPS Demo Boundary, so the geofence condition was true.
- The alarm was requested with \`volume = 20\` for 3 seconds.
- Delivery was not confirmed: the command was sent, but the device has not reported the new state.

Next steps:

1. Open the evaluation and check the action timeline.
2. If the alarm stays silent, compare its reported volume with the requested value.

| Parameter | Unit | Type |
| --- | --- | --- |
| temperature | °C | number |
| door_open | — | boolean |

Readings were ~20 °C to ~25 °C. Keep [the device guide](https://example.com/guide) nearby.`

/**
 * An assistant reply in a chat panel. Lists, emphasis, inline code and small
 * tables render with the type scale; a single "~" stays literal and line breaks
 * are kept. Raw HTML is never rendered and images show only their alt text.
 */
export const Reply: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <Message>
        <MessageContent>
          <MessageHeader>Automation assistant</MessageHeader>
          <Bubble variant="ghost">
            <BubbleContent>
              <Markdown>{reply}</Markdown>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  ),
}

/** Code blocks scroll sideways instead of widening the panel. */
export const Code: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <Markdown>
        {"The decoder reads the first two bytes as a signed integer:\n\n```js\nconst raw = (bytes[0] << 8) | bytes[1]\nreturn { temperature: (raw > 32767 ? raw - 65536 : raw) / 10 }\n```\n\n> Test it against the saved fixtures before you deploy."}
      </Markdown>
    </div>
  ),
}

/** Untrusted input: HTML stays text and an image never loads. */
export const Untrusted: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <Markdown>
        {'<b>Raw HTML</b> is shown as text.\n\n![Tracking pixel](https://example.com/pixel.png?data=secret)'}
      </Markdown>
    </div>
  ),
}
