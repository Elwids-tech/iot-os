"use client"

import { useEffect, useId, useState } from "react"
import { CheckIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { cn } from "@iot-os/ui/lib/utils"
import {
  PickerAddon,
  pickerTriggerClassName,
} from "@iot-os/ui/components/select"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@iot-os/ui/components/command"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@iot-os/ui/components/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iot-os/ui/components/popover"

type Option = { value: string; label: string }

/** A single picker with server-side search and bounded result pages. */
export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  search,
  onSearchChange,
  loading = false,
  disabled,
  help,
  selectedLabel,
  placeholder = "Choose an option",
  emptyText = "No matches found.",
  page = 1,
  hasNextPage = false,
  onPageChange,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  search: string
  onSearchChange: (search: string) => void
  loading?: boolean
  disabled?: boolean
  help?: string
  selectedLabel?: string
  placeholder?: string
  emptyText?: string
  page?: number
  hasNextPage?: boolean
  onPageChange?: (page: number) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [remembered, setRemembered] = useState<Record<string, string>>({})
  const selected = options.find((option) => option.value === value)
  useEffect(() => {
    if (selected)
      setRemembered((current) => ({
        ...current,
        [selected.value]: selected.label,
      }))
  }, [selected?.value, selected?.label])
  const displayLabel =
    selectedLabel ?? selected?.label ?? remembered[value] ?? placeholder
  const visibleOptions = options.filter(
    (option) => option.value !== "" || !search,
  )
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover
        open={open && !disabled}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onSearchChange("")
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            data-slot="searchable-select-trigger"
            data-size="default"
            data-placeholder={displayLabel === placeholder ? "" : undefined}
            aria-expanded={open && !disabled}
            aria-describedby={help ? id + "-help" : undefined}
            disabled={disabled}
            className={cn(pickerTriggerClassName, "w-full min-w-0")}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                setOpen(true)
              }
            }}
          >
            <span className="truncate">{displayLabel}</span>
            <PickerAddon />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-64 max-w-[calc(100vw-2rem)] p-0"
          aria-label={label}
        >
          <Command shouldFilter={false} defaultValue={value || "__empty"}>
            <CommandInput
              aria-label={"Search " + label.toLowerCase()}
              placeholder={"Search " + label.toLowerCase() + "…"}
              value={search}
              onValueChange={onSearchChange}
            />
            <CommandList aria-label={label} aria-busy={loading}>
              {loading ? (
                <p role="status" className="p-3 text-sm text-muted-foreground">
                  Loading options…
                </p>
              ) : (
                <>
                  {visibleOptions.length === 0 ? (
                    <CommandGroup>
                      <CommandItem disabled value="__no-results">
                        {emptyText}
                      </CommandItem>
                    </CommandGroup>
                  ) : (
                    <CommandGroup>
                      {visibleOptions.map((option) => (
                        <CommandItem
                          key={option.value}
                          value={option.value || "__empty"}
                          data-checked={value === option.value}
                          onSelect={() => {
                            setRemembered((current) => ({
                              ...current,
                              [option.value]: option.label,
                            }))
                            if (option.value !== value) onChange(option.value)
                            setOpen(false)
                            onSearchChange("")
                          }}
                        >
                          <span className="min-w-0 break-words">
                            {option.label}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
          {onPageChange && (page > 1 || hasNextPage) && (
            <div className="flex items-center justify-between gap-2 border-t p-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={loading || page <= 1}
                aria-label={"Previous " + label.toLowerCase() + " options"}
                onClick={() => onPageChange(page - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground" role="status">
                Page {page}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={loading || !hasNextPage}
                aria-label={"Next " + label.toLowerCase() + " options"}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {help && <FieldDescription id={id + "-help"}>{help}</FieldDescription>}
    </Field>
  )
}

/** A bounded multi-picker with search inside the selector. */
export function SearchableMultiSelect({
  label,
  values,
  options,
  onChange,
  maximum = 100,
  help,
  disabled,
  placeholder = "Choose options",
}: {
  label: string
  values: string[]
  options: Option[]
  onChange: (values: string[]) => void
  maximum?: number
  help?: string
  disabled?: boolean
  placeholder?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const selected = new Set(values)
  const display = values.length
    ? `${values.length} selected`
    : placeholder
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            data-slot="searchable-select-trigger"
            data-size="default"
            data-placeholder={values.length ? undefined : ""}
            aria-expanded={open && !disabled}
            aria-describedby={help ? id + "-help" : undefined}
            disabled={disabled}
            className={cn(pickerTriggerClassName, "w-full min-w-0")}
          >
            <span className="truncate">{display}</span>
            <PickerAddon />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0" aria-label={label}>
          <Command>
            <CommandInput aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} />
            <CommandList aria-label={label}>
              <CommandGroup>
                {options.map((option) => {
                  const checked = selected.has(option.value)
                  const blocked = !checked && values.length >= maximum
                  return (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value}`}
                      disabled={blocked}
                      data-checked={checked}
                      onSelect={() => onChange(checked ? values.filter((value) => value !== option.value) : [...values, option.value])}
                    >
                      <CheckIcon className={checked ? "opacity-100" : "opacity-0"} />
                      <span className="min-w-0 break-words">{option.label}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          <div className="border-t p-2 text-xs text-muted-foreground">{values.length} of {maximum} selected</div>
        </PopoverContent>
      </Popover>
      {help && <FieldDescription id={id + "-help"}>{help}</FieldDescription>}
    </Field>
  )
}
