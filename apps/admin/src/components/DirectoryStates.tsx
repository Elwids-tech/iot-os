import type { ReactNode } from "react"
import { AlertCircleIcon, InboxIcon, SearchXIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@iot-os/ui/components/empty"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table"
import { useSearchParams } from "react-router-dom"

export function DirectoryError() {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>Could not load this directory</AlertTitle>
      <AlertDescription>Refresh the page to try again.</AlertDescription>
    </Alert>
  )
}

/** "No matching …" with Clear filters when filtered, otherwise "No … yet" with an optional next step. */
export function DirectoryEmpty({
  noun,
  filtered,
  hint,
  action,
}: {
  noun: string
  filtered: boolean
  hint: string
  action?: ReactNode
}) {
  const [, setSearchParams] = useSearchParams()

  return (
    <Empty className="min-h-64 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{filtered ? <SearchXIcon /> : <InboxIcon />}</EmptyMedia>
        <EmptyTitle>{filtered ? `No matching ${noun}` : `No ${noun} yet`}</EmptyTitle>
        {filtered ? <EmptyDescription>{hint}</EmptyDescription> : null}
      </EmptyHeader>
      {filtered ? (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => setSearchParams(new URLSearchParams())}>
            Clear filters
          </Button>
        </EmptyContent>
      ) : action ? (
        <EmptyContent>{action}</EmptyContent>
      ) : null}
    </Empty>
  )
}

export function DirectoryLoading({ headings }: { headings: string[] }) {
  return (
    <Table aria-busy="true">
      <TableHeader>
        <TableRow>
          {headings.map((heading) => (
            <TableHead key={heading}>{heading}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 5 }, (_, row) => (
          <TableRow key={row}>
            {headings.map((heading) => (
              <TableCell key={heading}>
                <Skeleton className="h-4 w-28" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function countLabel(total: number, singular: string, plural: string): string {
  return `${total.toLocaleString()} ${total === 1 ? singular : plural}`
}
