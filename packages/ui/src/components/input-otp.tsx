import * as React from "react"
import { OTPInput, OTPInputContext, REGEXP_ONLY_DIGITS } from "input-otp"
import { MinusIcon } from "lucide-react"

import { cn } from "@iot-os/ui/lib/utils"

/**
 * A one-time code, one box per character (shadcn `input-otp`). The boxes are drawn over a
 * single real input, so paste, autofill (`autoComplete="one-time-code"`) and screen readers
 * work as with any text field. Set `aria-invalid` to show a refused code.
 */
function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        // Phones: the boxes share the field's width, up to 18 rem, so they fit any card.
        "flex items-center gap-2 has-disabled:opacity-50 max-md:w-full max-md:max-w-72",
        containerClassName,
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn("flex items-center max-md:min-w-0 max-md:flex-1", className)}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  index: number
}) {
  const context = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = context?.slots[index] ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        // The kit's inset field, one box per character, with 16 px digits. Phones: 44 px tall,
        // and the boxes share the width.
        "relative flex size-9 items-center justify-center border-y border-r border-input bg-input-fill font-mono text-base tabular-nums shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-[color,box-shadow] outline-none first:rounded-l-lg first:border-l last:rounded-r-lg max-md:h-11 max-md:w-auto max-md:min-w-0 max-md:flex-1 dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]",
        "data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/50",
        "aria-invalid:border-destructive data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/20 dark:data-[active=true]:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground" />
        </div>
      )}
    </div>
  )
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-separator"
      role="separator"
      // Phones: the gap between the groups is enough, and the dash would not fit.
      className="text-muted-foreground max-md:hidden"
      {...props}
    >
      <MinusIcon className="size-4" />
    </div>
  )
}

/**
 * Six digits from an authenticator app, as two groups of three. `invalid` marks every box
 * after a refused code; the caller shows the message in a `FieldError`. Keep it enabled
 * while a code is checked: a disabled input drops focus, and the next code typed is lost.
 */
function SixDigitCode({
  value,
  onChange,
  onComplete,
  invalid = false,
  disabled = false,
  autoFocus = false,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  invalid?: boolean
  disabled?: boolean
  autoFocus?: boolean
  id?: string
  /** Only without a `FieldLabel` pointing at `id`: a label of its own would override it. */
  "aria-label"?: string
  "aria-describedby"?: string
}) {
  return (
    <InputOTP
      id={id}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      <InputOTPGroup>
        {[0, 1, 2].map((index) => (
          <InputOTPSlot key={index} index={index} aria-invalid={invalid || undefined} />
        ))}
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        {[3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} aria-invalid={invalid || undefined} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator, SixDigitCode }
