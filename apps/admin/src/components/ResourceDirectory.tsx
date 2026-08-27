import type { ReactNode } from "react"
import type { PaginationMeta } from "@iot-os/api-client"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import { Separator } from "@iot-os/ui/components/separator"
import { PaginationControls } from "./PaginationControls"

type ResourceDirectoryProps = {
  title: string
  description: string
  directoryTitle: string
  directoryDescription: string
  filters: ReactNode
  children: ReactNode
  pagination?: PaginationMeta
  actions?: ReactNode
  after?: ReactNode
}

export function ResourceDirectory({
  title,
  description,
  directoryTitle,
  directoryDescription,
  filters,
  children,
  pagination,
  actions,
  after,
}: ResourceDirectoryProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {actions}
      </div>
      <Card className="min-w-0">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{directoryTitle}</CardTitle>
            <CardDescription>{directoryDescription}</CardDescription>
          </div>
          {filters}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">{children}</CardContent>
        {pagination ? (
          <>
            <Separator />
            <CardFooter className="py-4">
              <PaginationControls meta={pagination} />
            </CardFooter>
          </>
        ) : null}
      </Card>
      {after}
    </section>
  )
}
