import { AlertCircleIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"

export function DirectoryError() {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>Could not load this directory</AlertTitle>
      <AlertDescription>Refresh the page to try again.</AlertDescription>
    </Alert>
  )
}

export function countLabel(total: number, singular: string, plural: string): string {
  return `${total.toLocaleString()} ${total === 1 ? singular : plural}`
}
