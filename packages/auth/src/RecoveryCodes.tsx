import { useEffect, useState } from "react"
import { Button } from "@iot-os/ui/components/button"
import { CheckboxField } from "@iot-os/ui/components/form-fields"
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react"

/** The file is named after this deployment's address, never the product (spec 034). */
export function recoveryCodesFile(codes: string[], host = window.location.hostname) {
  const name = `${host.replace(/[^a-z0-9.-]/gi, "-") || "sign-in"}-recovery-codes.txt`
  const text = [
    `Recovery codes for ${host}`,
    "",
    "Use one of these if you cannot get a code from your authenticator app.",
    "Each code works once. Keep them somewhere safe, away from your phone.",
    "",
    ...codes,
    "",
  ].join("\n")
  return { name, text }
}

/**
 * The recovery codes, shown once (spec 034, FR-004 and FR-005): copy or download them,
 * then confirm they are saved before **Done**.
 */
export function RecoveryCodes({
  codes,
  onDone,
  doneLabel = "Done",
}: {
  codes: string[]
  onDone: () => void
  doneLabel?: string
}) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"))
      setCopied(true)
    } catch {
      // The clipboard can be blocked; the codes stay selectable, and Download still works.
    }
  }

  function download() {
    const file = recoveryCodesFile(codes)
    const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain" }))
    const link = document.createElement("a")
    link.href = url
    link.download = file.name
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted-foreground">
        Each code signs you in once if you cannot use your authenticator app. They are shown only now: save them
        somewhere safe, such as a password manager.
      </p>
      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 p-4 font-mono text-code select-all sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="tabular-nums">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <CheckIcon data-icon="inline-start" className="text-success" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <DownloadIcon data-icon="inline-start" />
          Download
        </Button>
      </div>
      <CheckboxField id="recovery-codes-saved" label="I have saved these codes" checked={saved} onCheckedChange={setSaved} />
      <Button type="button" className="sm:w-fit sm:self-end" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  )
}
