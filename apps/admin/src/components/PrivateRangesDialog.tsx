import { useEffect, useState } from "react"
import { ApiError } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldGroup } from "@iot-os/ui/components/field"
import { TextareaField } from "@iot-os/ui/components/form-fields"
import { AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "../lib/api-client"

/** One CIDR range per line; blank lines and spaces are ignored. */
export function parseRanges(text: string): string[] {
  return [...new Set(text.split(/[\n,]+/).map((line) => line.trim()).filter(Boolean))]
}

/**
 * The private network ranges an organization's OPC UA connections may reach (spec 038,
 * FR-008). Staff only: loopback, link-local, the metadata address and the platform's own
 * networks are always refused.
 */
export function PrivateRangesDialog({
  organization,
  onClose,
}: {
  organization: { uuid: string; name: string } | null
  onClose: () => void
}) {
  const [text, setText] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setText("")
    setError(null)
    setLoaded(false)
    if (!organization) return
    let active = true
    apiClient
      .adminAdapterPrivateRanges(organization.uuid)
      .then(({ private_ranges }) => {
        if (!active) return
        setText(private_ranges.join("\n"))
        setLoaded(true)
      })
      .catch(() => active && setError("The ranges could not be loaded. Close and try again."))
    return () => {
      active = false
    }
  }, [organization])

  async function save() {
    if (!organization) return
    setBusy(true)
    setError(null)
    try {
      const { private_ranges } = await apiClient.saveAdminAdapterPrivateRanges(organization.uuid, parseRanges(text))
      toast.success(private_ranges.length ? `${organization.name} may reach ${private_ranges.length} private range${private_ranges.length === 1 ? "" : "s"}` : `${organization.name} reaches public addresses only`)
      onClose()
    } catch (reason) {
      const message = reason instanceof ApiError ? (reason.payload as { message?: string } | null)?.message : undefined
      setError(message ?? "The ranges could not be saved. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={organization !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Private network ranges</DialogTitle>
          <DialogDescription>
            The private addresses {organization?.name}&apos;s OPC UA connections may reach, for a building reached over a
            VPN. Leave it empty to allow public addresses only.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <TextareaField
            label="Ranges"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            disabled={busy || !loaded}
            placeholder={"10.20.0.0/16\n192.168.40.0/24"}
            help="One range per line in CIDR notation. Loopback, link-local and the platform's own networks are never reachable."
            spellCheck={false}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy || !loaded}>
            {busy ? "Saving…" : "Save ranges"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
