import * as React from "react"

import { cn } from "@iot-os/ui/lib/utils"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@iot-os/ui/components/field"
import { RadioGroupItem } from "@iot-os/ui/components/radio-group"

/**
 * One selectable card in a set: a radio (inside a RadioGroup) or a checkbox,
 * with a title, supporting text and an optional leading icon or trailing
 * badge. The whole card is the label, so clicking anywhere selects it, and
 * the checked state tints the card through the shared FieldLabel styles.
 */
function ChoiceCard({
  type = "radio",
  value,
  checked,
  onCheckedChange,
  disabled,
  title,
  description,
  icon,
  badge,
  className,
  children,
}: {
  type?: "radio" | "checkbox"
  /** Required for radios; used as the checkbox id otherwise. */
  value: string
  /** Radios read their state from the RadioGroup; checkboxes need both of these. */
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  badge?: React.ReactNode
  className?: string
  /** Extra content shown under the description, e.g. inputs revealed when selected. */
  children?: React.ReactNode
}) {
  const generated = React.useId()
  const id = `${type}-${value}-${generated}`
  const control =
    type === "radio" ? (
      <RadioGroupItem
        id={id}
        value={value}
        disabled={disabled}
        data-checked={checked ? "" : undefined}
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
      />
    ) : (
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        data-checked={checked ? "" : undefined}
        onCheckedChange={(next) => onCheckedChange?.(next === true)}
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
      />
    )
  return (
    <FieldLabel htmlFor={id} data-slot="choice-card" className={className}>
      <Field orientation="horizontal" data-disabled={disabled}>
        {control}
        {icon && (
          <span aria-hidden="true" className="mt-px shrink-0 text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        )}
        <FieldContent>
          <FieldTitle id={`${id}-title`} className={cn("w-full", badge && "justify-between")}>
            <span className="min-w-0">{title}</span>
            {badge}
          </FieldTitle>
          {description && (
            <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
          )}
          {children}
        </FieldContent>
      </Field>
    </FieldLabel>
  )
}

export { ChoiceCard }
