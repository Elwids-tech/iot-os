import { useSyncExternalStore } from "react";

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

