import type { PaginationMeta } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { useSearchParams } from "react-router-dom"

const number = new Intl.NumberFormat()

export function PaginationControls({ meta }: { meta: PaginationMeta }) {
  const [searchParams, setSearchParams] = useSearchParams()

  function changePage(page: number) {
    const next = new URLSearchParams(searchParams)

    if (page <= 1) {
      next.delete("page")
    } else {
      next.set("page", page.toString())
    }

    setSearchParams(next)
  }

  return (
    <div className="flex w-full flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>
        {meta.from === null || meta.to === null
          ? "No results"
          : `${number.format(meta.from)}–${number.format(meta.to)} of ${number.format(meta.total)}`}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={meta.current_page <= 1}
          aria-label="Go to previous page"
          onClick={() => changePage(meta.current_page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={meta.current_page >= meta.last_page}
          aria-label="Go to next page"
          onClick={() => changePage(meta.current_page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
