import { useSyncExternalStore } from "react";
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

export function Age({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatAge(value)} ago
    </time>
  );
}
