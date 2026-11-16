import { CheckboxField } from "@iot-os/ui/components/form-fields"

/**
 * Keep me signed in (spec 033, FR-011a): off by default. When ticked, this browser or
 * installed app stays signed in for 30 days, so the hint warns against shared devices.
 */
export function KeepSignedIn({
  id,
  checked,
  onCheckedChange,
}: {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <CheckboxField
      id={id}
      label="Keep me signed in"
      description="Don't tick this on a shared device."
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  )
}

/** The login body: `remember` is sent only when ticked, so an unticked sign-in is as before. */
export const credentials = (email: string, password: string, remember: boolean) =>
  remember ? { email, password, remember: true } : { email, password }
