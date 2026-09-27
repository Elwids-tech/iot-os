import { useSyncExternalStore, type ComponentProps } from "react";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { formatAge, formatDateTime } from "@iot-os/ui/lib/format";

const WIDE = "(min-width: 1280px)";
/** Split views show list and detail side by side from 1280px; below that one pane per route. */
export function useWide() {
  return useSyncExternalStore(
    (change) => {
      const media = window.matchMedia(WIDE);
      media.addEventListener("change", change);
      return () => media.removeEventListener("change", change);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

/** SearchableSelect with its label beside the trigger, for filter rows. */
export function InlineSelect(props: ComponentProps<typeof SearchableSelect>) {
  return (
    <div className="w-full sm:w-64 [&_[data-slot=field-label]]:w-auto [&_[data-slot=field-label]]:shrink-0 [&_[data-slot=field-label]]:font-normal [&_[data-slot=field-label]]:text-muted-foreground [&>[data-slot=field]]:flex-row [&>[data-slot=field]]:items-center [&_[role=combobox]]:shrink">
      <SearchableSelect {...props} />
    </div>
  );
}

export function Age({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatAge(value)} ago
    </time>
  );
}
