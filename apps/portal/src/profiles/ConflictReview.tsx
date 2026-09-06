import { useState } from "react"
import { ApiError, type DeviceProfileDetail } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog"
import { JsonEditor } from "@iot-os/ui/components/json-editor"
import { useStudio } from "./use-studio"
import { RequestError } from "../components/forms"
import { jsonText } from "./authoring"
export function ConflictReview({
  error,
  local,
  selectLatest,
  onRebase,
}: {
  error: unknown
  local: unknown
  selectLatest: (profile: DeviceProfileDetail) => unknown
  onRebase: (revision: number) => void
}) {
  const studio = useStudio()
  const [latest, setLatest] = useState<DeviceProfileDetail | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  if (!(error instanceof ApiError) || error.status !== 409) return null
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            setLatest(await studio.reload())
          } catch (reason) {
            setLoadError(reason)
          }
        }}
      >
        Review latest saved values
      </Button>
      <RequestError error={loadError} />
      <Dialog
        open={Boolean(latest)}
        onOpenChange={(open) => {
          if (!open) setLatest(null)
        }}
      >
        <DialogContent className="flex max-h-[90svh] flex-col overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review concurrent changes</DialogTitle>
            <DialogDescription>
              Your form has not changed. Compare it with the saved version
              before deciding to reapply your edits. Changes outside this form
              will be preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <JsonEditor
              label="Your pending form"
              readOnly
              value={jsonText(local)}
            />
            <JsonEditor
              label="Latest saved values"
              readOnly
              value={jsonText(latest ? selectLatest(latest) : null)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLatest(null)}
            >
              Keep reviewing
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (latest) onRebase(latest.draft_revision)
                setLatest(null)
              }}
            >
              Keep my edits on latest revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
