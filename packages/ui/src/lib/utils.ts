import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge reads unknown text-* names as colours. Teach it the named
// type scale (--text-* in globals.css) so text-meta survives next to
// text-muted-foreground and the last named size wins.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "heading", "body", "meta", "code", "micro"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
