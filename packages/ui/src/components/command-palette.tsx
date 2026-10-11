import * as React from "react"
import { Command as CommandPrimitive, defaultFilter } from "cmdk"
import { SearchIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { cn } from "@iot-os/ui/lib/utils"

export type PaletteItem = {
  id: string
  label: string
  hint?: string
  icon?: React.ReactNode
  /** Extra words the filter matches, such as a device code. */
  keywords?: string[]
  onSelect: () => void
}

/**
 * ⌘K: jump to any page or record and run common actions. Groups come from the
 * page; `search` lets the page fetch matching records as the viewer types.
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  search,
  onSearchChange,
  loading = false,
  placeholder = "Search pages, devices, dashboards…",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: { heading: string; items: PaletteItem[] }[]
  search: string
  onSearchChange: (value: string) => void
  loading?: boolean
  placeholder?: string
}) {
  // Records can arrive after the search changes (devices are fetched as you type). cmdk keeps its
  // earlier choice then, so select the top visible result again whenever the results change.
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selected, setSelected] = React.useState("")
  const results = groups.flatMap((group) => group.items.map((item) => `${group.heading}:${item.id}`)).join("\n")
  React.useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const first = listRef.current?.querySelector<HTMLElement>("[cmdk-item]:not([aria-disabled='true'])")
      setSelected(first?.dataset.value ?? "")
    })
    return () => cancelAnimationFrame(frame)
  }, [open, results])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search or jump to</DialogTitle>
        <DialogDescription className="sr-only">
          Type to find a page, a device, a dashboard or an action, then press Enter.
        </DialogDescription>
        <CommandPrimitive
          label="Search or jump to"
          className="flex flex-col"
          loop
          value={selected}
          onValueChange={setSelected}
          // Match the label and keywords only; the value carries the group and id to stay unique.
          filter={(_value, query, keywords = []) => defaultFilter(keywords.join(" "), query)}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              value={search}
              onValueChange={onSearchChange}
              placeholder={placeholder}
              aria-label="Search or jump to"
              className="h-12 w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border px-1.5 font-mono text-meta text-muted-foreground sm:inline">Esc</kbd>
          </div>
          <CommandPrimitive.List ref={listRef} className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
            <CommandPrimitive.Empty className="px-3 py-6 text-center text-body text-muted-foreground">
              {loading ? "Searching…" : "No matches"}
            </CommandPrimitive.Empty>
            {groups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <CommandPrimitive.Group
                  key={group.heading}
                  heading={group.heading}
                  className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-meta **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground"
                >
                  {group.items.map((item) => (
                    <CommandPrimitive.Item
                      key={item.id}
                      value={`${group.heading}:${item.id}`}
                      keywords={[item.label, ...(item.keywords ?? [])]}
                      onSelect={() => {
                        onOpenChange(false)
                        item.onSelect()
                      }}
                      className={cn(
                        "flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-body outline-none select-none",
                        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
                      )}
                    >
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                      {item.hint && (
                        <span className="ml-auto truncate pl-3 text-meta text-muted-foreground">{item.hint}</span>
                      )}
                    </CommandPrimitive.Item>
                  ))}
                </CommandPrimitive.Group>
              ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}
