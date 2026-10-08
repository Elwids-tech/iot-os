import { lazy, Suspense, useState } from "react"
import { Button } from "@iot-os/ui/components/button"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@iot-os/ui/components/dialog"
import { CopyIcon, ExpandIcon, BracesIcon, SearchIcon } from "lucide-react"
const JsonCode = lazy(() => import("./json-code"))
export function JsonEditor({
  label,
  value,
  onChange,
  readOnly = false,
  language = "json",
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  language?: "json" | "javascript"
}) {
  const [expanded, setExpanded] = useState(false)
  const [searchRequest, setSearchRequest] = useState(0)
  const [notice, setNotice] = useState("")
  let parseError = ""
  try {
    if (language === "json") JSON.parse(value)
  } catch {
    parseError =
      "This is not valid JSON yet. Your text is preserved; correct it before saving."
  }
  const editor = (
    <Suspense fallback={<Skeleton className="h-full w-full" />}>
      <JsonCode
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
        searchRequest={searchRequest}
        language={language}
      />
    </Suspense>
  )
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
          {readOnly ? " · Read only" : ""}
        </span>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setSearchRequest((value) => value + 1)}
          >
            <SearchIcon data-icon="inline-start" />
            Search
          </Button>
          {!readOnly && language === "json" && (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={Boolean(parseError)}
              onClick={() =>
                onChange?.(JSON.stringify(JSON.parse(value), null, 2))
              }
            >
              <BracesIcon data-icon="inline-start" />
              Format
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value)
                setNotice("Copied")
              } catch {
                setNotice("Select the text to copy it manually.")
              }
            }}
          >
            <CopyIcon data-icon="inline-start" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setExpanded(true)}
          >
            <ExpandIcon data-icon="inline-start" />
            Expand
          </Button>
        </div>
      </div>
      <div className="h-72 min-w-0 overflow-hidden">{!expanded && editor}</div>
      {(parseError || notice) && (
        <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
          {parseError || notice}
        </p>
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[85svh] max-w-[95vw] flex-col sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {readOnly
                ? "Immutable definition. Search and inspect without changing it."
                : "Advanced code. Close this view to return to the form."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setSearchRequest((value) => value + 1)}
            >
              Search code
            </Button>
            {!readOnly && language === "json" && (
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={Boolean(parseError)}
                onClick={() =>
                  onChange?.(JSON.stringify(JSON.parse(value), null, 2))
                }
              >
                Format JSON
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1">{expanded && editor}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
