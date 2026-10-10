import { useState } from "react"
import { Button } from "@iot-os/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@iot-os/ui/components/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iot-os/ui/components/popover"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { PANEL_LABELS } from "./model"
import { PANEL_ICONS } from "./icons"
import { widgetRegistry } from "./registry"
import {
  OTHER_PANELS,
  PARAMETER_PANELS,
  incompatibility,
  suggestPanels,
  type Candidate,
  type PanelType,
} from "./suggest"

/**
 * One Visualization control instead of a strip of every panel type. Opens a
 * searchable gallery: suggestions for the selected data first, the rest with
 * a reason when they cannot show it, then panels that use no parameters.
 */
export function VisualizationPicker({
  value,
  candidates,
  onChange,
  disabled,
}: {
  value: PanelType
  candidates: Candidate[]
  onChange: (type: PanelType) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const suggestions = suggestPanels(candidates)
  const suggested = new Set(suggestions.map((s) => s.type))
  const Icon = PANEL_ICONS[value]
  const choose = (type: PanelType) => {
    setOpen(false)
    if (type !== value) onChange(type)
  }
  const item = (type: PanelType, detail: string, unavailable?: string | null) => {
    const ItemIcon = PANEL_ICONS[type]
    return (
      <CommandItem
        key={type}
        value={`${PANEL_LABELS[type]} ${detail}`}
        disabled={Boolean(unavailable)}
        onSelect={() => choose(type)}
        className="items-start gap-3 py-2"
      >
        <ItemIcon className="mt-0.5 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{PANEL_LABELS[type]}</span>
          <span className="text-xs text-muted-foreground">{unavailable ?? detail}</span>
        </span>
        {type === value && <CheckIcon className="mt-0.5" aria-label="Current" />}
      </CommandItem>
    )
  }
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Visualization: ${PANEL_LABELS[value]}`}
          disabled={disabled}
          className="h-auto w-full justify-start gap-3 py-2 text-left"
        >
          <Icon className="text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-normal text-muted-foreground">Visualization</span>
            <span className="truncate font-medium">{PANEL_LABELS[value]}</span>
          </span>
          <ChevronsUpDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0" aria-label="Visualizations">
        <Command>
          <CommandInput aria-label="Search visualizations" placeholder="Search visualizations…" />
          <CommandList className="max-h-[min(28rem,60svh)]">
            <CommandEmpty>No visualization matches.</CommandEmpty>
            {suggestions.length > 0 && (
              <CommandGroup heading="Suggested for this data">
                {suggestions.map((s) => item(s.type, s.reason))}
              </CommandGroup>
            )}
            <CommandGroup heading={suggestions.length ? "Other visualizations" : "Visualizations"}>
              {PARAMETER_PANELS.filter((type) => !suggested.has(type)).map((type) =>
                item(type, widgetRegistry[type].description, incompatibility(type, candidates)),
              )}
            </CommandGroup>
            <CommandGroup heading="Without device parameters">
              {OTHER_PANELS.map((type) => item(type, widgetRegistry[type].description))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
