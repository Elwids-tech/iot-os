import type { ReactNode } from "react"
import type { PaginationMeta } from "@iot-os/api-client"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { useSearchParams } from "react-router-dom"
import { PaginationControls } from "./PaginationControls"

type ResourceDirectoryProps = {
  title: string
  filters: ReactNode
  /** Result count shown at the end of the filter row, e.g. "3 users". */
  count?: string
  children: ReactNode
  pagination?: PaginationMeta
  actions?: ReactNode
  after?: ReactNode
}

export function ResourceDirectory({
  title,
  filters,
  count,
  children,
  pagination,
  actions,
  after,
}: ResourceDirectoryProps) {
  const [searchParams, setSearchParams] = useSearchParams()

  function changePage(page: number) {
    const next = new URLSearchParams(searchParams)
    if (page <= 1) next.delete("page")
    else next.set("page", page.toString())
    setSearchParams(next)
  }

  return (
    <>
      <PageHeader title={title} actions={actions}>
        {filters}
        {count ? (
          <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </PageHeader>
      <div className="flex min-w-0 flex-col gap-10 p-4 md:p-6">
        <div className="min-w-0">
          {children}
          {pagination ? (
            <PaginationControls meta={pagination} label={`${title} pages`} onPage={changePage} />
          ) : null}
        </div>
        {after}
      </div>
    </>
  )
}
