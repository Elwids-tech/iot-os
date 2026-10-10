import { ChevronDownIcon, LockKeyholeIcon } from "lucide-react"

import { Checkbox } from "@iot-os/ui/components/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@iot-os/ui/components/collapsible"
import { permissionGroupLabel, permissionLabel } from "@iot-os/ui/lib/permission-labels"

export type PermissionMatrixItem = {
  name: string
  group: string
  /** Set when this permission cannot be changed; shown as the lock's explanation. */
  lockedReason?: string | null
}

type PermissionMatrixProps = {
  permissions: PermissionMatrixItem[]
  selected: ReadonlySet<string>
  /** The saved selection; differences are marked "added" or "removed". */
  initial?: ReadonlySet<string>
  disabled?: boolean
  onChange: (next: Set<string>) => void
  idPrefix?: string
  /** Heading level for group titles, to fit the surrounding outline. */
  headingLevel?: 2 | 3
}

/** Grouped permission checkboxes with a select-all per group. Locked items keep their state. */
export function PermissionMatrix({
  permissions,
  selected,
  initial,
  disabled = false,
  onChange,
  idPrefix = "permission",
  headingLevel = 2,
}: PermissionMatrixProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  const groups = new Map<string, PermissionMatrixItem[]>()
  for (const permission of permissions) {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission])
  }

  const update = (names: string[], checked: boolean) => {
    const next = new Set(selected)
    for (const name of names) {
      if (checked) next.add(name)
      else next.delete(name)
    }
    onChange(next)
  }

  return (
    <div className="border-t">
      {[...groups.entries()].map(([group, items]) => {
        const label = permissionGroupLabel(group)
        const editable = items.filter((item) => !item.lockedReason)
        const selectedCount = items.filter((item) => selected.has(item.name)).length
        // A fully locked group still shows its real state; otherwise reflect what select-all would change.
        const scope = editable.length ? editable : items
        const scopeSelected = scope.filter((item) => selected.has(item.name)).length
        const groupChecked =
          scopeSelected === 0 ? false : scopeSelected === scope.length ? true : "indeterminate"

        return (
          <Collapsible key={group} defaultOpen asChild>
            <section className="border-b">
              <div className="flex h-10 items-center gap-3">
                <Checkbox
                  aria-label={`Select all ${label} permissions`}
                  checked={groupChecked}
                  disabled={disabled || editable.length === 0}
                  onCheckedChange={() => update(editable.map((item) => item.name), groupChecked !== true)}
                />
                <Heading className="min-w-0 flex-1 text-sm font-semibold">
                  <CollapsibleTrigger className="group/trigger flex h-10 w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronDownIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground group-data-[state=closed]/trigger:-rotate-90"
                    />
                    {label}
                  </CollapsibleTrigger>
                </Heading>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {selectedCount} of {items.length} selected
                </span>
              </div>
              <CollapsibleContent>
                <fieldset className="grid gap-x-6 pb-3 sm:grid-cols-2 sm:pl-7 xl:grid-cols-3">
                  <legend className="sr-only">{label} permissions</legend>
                  {items.map((item) => {
                    const id = `${idPrefix}-${item.name}`
                    const checked = selected.has(item.name)
                    const changed = initial !== undefined && checked !== initial.has(item.name)

                    return (
                      <label
                        key={item.name}
                        className="group/permission flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-sm hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
                        htmlFor={id}
                        title={item.lockedReason ?? undefined}
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={disabled || Boolean(item.lockedReason)}
                          onCheckedChange={(value) => update([item.name], value === true)}
                        />
                        <span className="truncate">{permissionLabel(item.name)}</span>
                        {item.lockedReason ? (
                          <>
                            <LockKeyholeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="sr-only">{item.lockedReason}</span>
                          </>
                        ) : null}
                        <span className="ml-auto hidden truncate font-mono text-xs text-muted-foreground group-hover/permission:inline group-focus-within/permission:inline">
                          {item.name}
                        </span>
                        {changed ? (
                          <span
                            className={
                              checked
                                ? "shrink-0 text-xs text-foreground"
                                : "shrink-0 text-xs text-muted-foreground line-through"
                            }
                          >
                            {checked ? "added" : "removed"}
                          </span>
                        ) : null}
                      </label>
                    )
                  })}
                </fieldset>
              </CollapsibleContent>
            </section>
          </Collapsible>
        )
      })}
    </div>
  )
}

/** Counts of permissions added and removed relative to the saved selection. */
export function permissionChanges(selected: ReadonlySet<string>, initial: ReadonlySet<string>) {
  let added = 0
  let removed = 0
  for (const name of selected) if (!initial.has(name)) added += 1
  for (const name of initial) if (!selected.has(name)) removed += 1
  return { added, removed, dirty: added + removed > 0 }
}
