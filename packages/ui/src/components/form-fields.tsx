import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { cn } from "@iot-os/ui/lib/utils"
import { Button } from "@iot-os/ui/components/button"
import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { Switch } from "@iot-os/ui/components/switch"
import { Textarea } from "@iot-os/ui/components/textarea"

/*
 * The form kit: one labelled wrapper per control family so every form reads
 * the same way. Label above, help text below, errors below the help text,
 * optional fields marked, required ones not. Pages compose these inside
 * FieldGroup and FormSection and never restyle labels.
 */

type FieldChrome = {
  label: React.ReactNode
  help?: React.ReactNode
  error?: React.ReactNode
  optional?: boolean
}

function describedBy(id: string, help: unknown, error: unknown) {
  return (
    [help && id + "-help", error && id + "-error"].filter(Boolean).join(" ") ||
    undefined
  )
}

/** Single-line text entry. */
function TextField({
  label,
  help,
  error,
  optional,
  className,
  ...props
}: React.ComponentProps<typeof Input> & FieldChrome) {
  const generated = React.useId()
  const id = props.id ?? generated
  return (
    <Field data-invalid={Boolean(error)} data-disabled={props.disabled}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <Input
        {...props}
        id={id}
        className={className}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, help, error)}
      />
      {help && <FieldDescription id={id + "-help"}>{help}</FieldDescription>}
      {error && <FieldError id={id + "-error"}>{error}</FieldError>}
    </Field>
  )
}

/** Multi-line text entry. */
function TextareaField({
  label,
  help,
  error,
  optional,
  ...props
}: React.ComponentProps<typeof Textarea> & FieldChrome) {
  const generated = React.useId()
  const id = props.id ?? generated
  return (
    <Field data-invalid={Boolean(error)} data-disabled={props.disabled}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <Textarea
        {...props}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, help, error)}
      />
      {help && <FieldDescription id={id + "-help"}>{help}</FieldDescription>}
      {error && <FieldError id={id + "-error"}>{error}</FieldError>}
    </Field>
  )
}

const NONE = "__none"

/** A picker over a short, known option list. Use SearchableSelect for long or remote lists. */
function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  help,
  error,
  optional,
  placeholder,
  id: idProp,
  className,
}: FieldChrome & {
  id?: string
  value: string
  options: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const generated = React.useId()
  const id = idProp ?? generated
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <Select
        value={value || NONE}
        onValueChange={(next) => onChange(next === NONE ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={cn("w-full", className)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(id, help, error)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value || NONE}
                disabled={option.disabled}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {help && <FieldDescription id={id + "-help"}>{help}</FieldDescription>}
      {error && <FieldError id={id + "-error"}>{error}</FieldError>}
    </Field>
  )
}

type ToggleChrome = {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  /** `start` puts the control before the label (forms); `end` puts it after (settings rows). */
  align?: "start" | "end"
  className?: string
}

function ToggleRow({
  control,
  label,
  description,
  id,
  align,
  disabled,
  className,
}: {
  control: React.ReactNode
  id: string
} & Pick<ToggleChrome, "label" | "description" | "align" | "disabled" | "className">) {
  const text = description ? (
    <FieldContent>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldDescription id={id + "-description"}>{description}</FieldDescription>
    </FieldContent>
  ) : (
    <FieldLabel htmlFor={id} className="font-normal">
      {label}
    </FieldLabel>
  )
  return (
    <Field
      orientation="horizontal"
      data-disabled={disabled}
      className={cn(align === "end" && "justify-between", className)}
    >
      {align === "end" ? (
        <>
          {text}
          {control}
        </>
      ) : (
        <>
          {control}
          {text}
        </>
      )}
    </Field>
  )
}

/** An on/off setting that applies as soon as it is saved. */
function SwitchField({
  checked,
  onCheckedChange,
  disabled,
  id: idProp,
  description,
  ...rest
}: ToggleChrome) {
  const generated = React.useId()
  const id = idProp ?? generated
  return (
    <ToggleRow
      id={id}
      description={description}
      disabled={disabled}
      {...rest}
      control={
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-describedby={description ? id + "-description" : undefined}
        />
      }
    />
  )
}

/** A yes/no choice inside a form that is saved with the rest of the form. */
function CheckboxField({
  checked,
  onCheckedChange,
  disabled,
  id: idProp,
  description,
  ...rest
}: ToggleChrome) {
  const generated = React.useId()
  const id = idProp ?? generated
  return (
    <ToggleRow
      id={id}
      description={description}
      disabled={disabled}
      {...rest}
      control={
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-describedby={description ? id + "-description" : undefined}
        />
      }
    />
  )
}

/**
 * A reference value shown beside editable fields: identifiers, derived units,
 * revisions. No border and no fill, so it never reads as editable. `copy`
 * adds a copy button; `mono` sets identifier typography.
 */
function ValueField({
  label,
  value,
  help,
  mono,
  copy,
  className,
  children,
}: {
  label: React.ReactNode
  value?: string | number | null
  help?: React.ReactNode
  mono?: boolean
  copy?: boolean
  className?: string
  children?: React.ReactNode
}) {
  const id = React.useId()
  const [copied, setCopied] = React.useState(false)
  const text = value == null || value === "" ? "—" : String(value)
  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Field className={className}>
      <FieldLabel id={id + "-label"}>{label}</FieldLabel>
      <div
        data-slot="value-field"
        role="group"
        aria-labelledby={id + "-label"}
        className={cn(
          "flex min-h-8 min-w-0 items-center gap-1.5 text-sm text-foreground",
          mono && "font-mono text-[13px]"
        )}
      >
        {children ?? (
          <span className="min-w-0 truncate select-all" title={text}>
            {text}
          </span>
        )}
        {copy && value != null && value !== "" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={copied ? "Copied" : `Copy ${typeof label === "string" ? label.toLowerCase() : "value"}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(String(value))
                setCopied(true)
              } catch {
                // Clipboard can be blocked; the text stays selectable.
              }
            }}
          >
            {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
          </Button>
        )}
      </div>
      {help && <FieldDescription>{help}</FieldDescription>}
    </Field>
  )
}

/** A titled group of fields inside a form. One heading style for every form. */
function FormSection({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  const id = React.useId()
  return (
    <section
      aria-labelledby={id}
      data-slot="form-section"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={id} className="skin-label text-sm font-semibold">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export {
  CheckboxField,
  FormSection,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
  ValueField,
}
