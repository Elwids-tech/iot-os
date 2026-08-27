import { AlertCircleIcon, SearchXIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import {
  Empty,
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

export function DirectoryError() {
  return (
    <Alert variant="destructive" className="m-6">
      <AlertCircleIcon />
      <AlertTitle>Could not load this directory</AlertTitle>
      <AlertDescription>Refresh the page to try again.</AlertDescription>
    </Alert>
  )
}

export function DirectoryEmpty({ description }: { description: string }) {
  return (
    <Empty className="min-h-72 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>No results found</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function DirectoryLoading({ headings }: { headings: string[] }) {
  return (
    <Table>
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
