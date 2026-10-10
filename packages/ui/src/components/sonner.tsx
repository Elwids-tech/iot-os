import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

// Toasts stack bottom-right, away from page headers and bulk-selection bars.
// Sonner pauses a toast while the pointer is over it, so a toast covering a
// button keeps swallowing clicks. Anything pinned to the bottom or right edge
// (sticky save bars, docked side panels) reports its size here, and the stack
// moves clear of it.
type Edge = "bottom" | "right"
const pinned: Record<Edge, Map<Element, number>> = {
  bottom: new Map(),
  right: new Map(),
}

function clearance(edge: Edge) {
  return (element: HTMLElement | null) => {
    if (!element) return
    const sizes = pinned[edge]
    const publish = () =>
      document.documentElement.style.setProperty(
        `--toast-clearance-${edge}`,
        `${Math.max(0, ...sizes.values())}px`,
      )
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect()
      const size = edge === "bottom" ? box.height : box.width
      // A bar at `bottom-3` needs its inset cleared too; hidden elements need nothing.
      const inset = parseFloat(getComputedStyle(element)[edge]) || 0
      sizes.set(element, box.width && box.height ? size + inset : 0)
      publish()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      sizes.delete(element)
      publish()
    }
  }
}

/** Ref for a sticky bar pinned to the bottom of the viewport: toasts stack above it. */
export const keepToastsAbove = clearance("bottom")
/** Ref for a panel pinned to the right edge: toasts stack to its left. */
export const keepToastsLeftOf = clearance("right")

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      offset={{
        bottom: "calc(24px + var(--toast-clearance-bottom, 0px))",
        // Never push the 356px stack off a narrow screen beside a side panel.
        right:
          "min(calc(24px + var(--toast-clearance-right, 0px)), calc(100vw - 380px))",
      }}
      // Below 600px toasts span the width, so only the bottom clearance applies.
      mobileOffset={{ bottom: "calc(16px + var(--toast-clearance-bottom, 0px))" }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
