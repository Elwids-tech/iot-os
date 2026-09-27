import type { PaginationMeta } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"

/** Previous / Page N of M / Next, like the portal directories. Hidden on a single page. */
export function PaginationControls({
  meta,
  label,
  onPage,
  disabled = false,
}: {
  meta: PaginationMeta
  label: string
  onPage: (page: number) => void
  disabled?: boolean
}) {
  if (meta.last_page < 2) return null

  return (
    <nav aria-label={label} className="mt-4 flex items-center justify-between gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || meta.current_page <= 1}
        onClick={() => onPage(meta.current_page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">
        Page {meta.current_page} of {meta.last_page}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || meta.current_page >= meta.last_page}
        onClick={() => onPage(meta.current_page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
