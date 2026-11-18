import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Field, FieldDescription, FieldError, FieldLabel } from "@iot-os/ui/components/field"
import { SixDigitCode } from "@iot-os/ui/components/input-otp"

const meta: Meta<typeof SixDigitCode> = { title: "Components/InputOTP", component: SixDigitCode }
export default meta

function Example({ initial = "", invalid = false, disabled = false }: { initial?: string; invalid?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <Field data-invalid={invalid || undefined} className="w-fit">
      <FieldLabel htmlFor="story-code">Code from your authenticator app</FieldLabel>
      <SixDigitCode id="story-code" value={value} onChange={setValue} invalid={invalid} disabled={disabled} />
      {invalid ? (
        <FieldError errors={[{ message: "That code is not valid. 4 tries left." }]} />
      ) : (
        <FieldDescription>Paste works too. Only digits are accepted.</FieldDescription>
      )}
    </Field>
  )
}

/** Six digits in two groups of three. One real input sits under the boxes, so paste and autofill work. */
export const SixDigits: StoryObj = { render: () => <Example /> }

/** A refused code marks every box and the message says how many tries are left. */
export const WithError: StoryObj = { render: () => <Example initial="123456" invalid /> }

/** While the code is being checked. */
export const Disabled: StoryObj = { render: () => <Example initial="482" disabled /> }
