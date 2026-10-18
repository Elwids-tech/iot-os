import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { BugIcon, LightbulbIcon, TrendingUpIcon } from "lucide-react"
import { toast } from "sonner"
import type { TicketType } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@iot-os/ui/components/collapsible"
import { Composer, type ComposerFile } from "@iot-os/ui/components/composer"
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { TextField } from "@iot-os/ui/components/form-fields"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { Panel, PanelContent } from "@iot-os/ui/components/panel"
import { PropertyList } from "@iot-os/ui/templates/entity-page"
import { RadioGroup } from "@iot-os/ui/components/radio-group"
import { keepToastsAbove } from "@iot-os/ui/components/sonner"
import { fieldError, RequestError } from "../components/forms"
import { api } from "../lib/api"
import { useUnsaved } from "../lib/unsaved"
import { browserContext, clientId, supportPath, ticketGuidance } from "./model"

const types: { value: TicketType; title: string; description: string; icon: ReactNode }[] = [
  { value: "bug", title: "Bug", description: "Something doesn't work as it should.", icon: <BugIcon /> },
  { value: "feature_request", title: "Feature request", description: "Something the platform can't do yet.", icon: <LightbulbIcon /> },
  { value: "improvement", title: "Improvement", description: "Something that works but could be better.", icon: <TrendingUpIcon /> },
]
const isType = (value: string | null): value is TicketType => types.some((type) => type.value === value)

/** File a bug report, feature request or improvement (spec 015 US1). */
export function NewTicketPage() {
  const org = useParams().organizationUuid!
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [params] = useSearchParams()
  const initialType = isType(params.get("type")) ? (params.get("type") as TicketType) : "bug"
  const context = useRef(browserContext(params.get("from") ?? window.location.pathname)).current
  const [type, setType] = useState<TicketType>(initialType)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [files, setFiles] = useState<ComposerFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  // The new ticket's uuid once filed; the page leaves for it after the form stops being dirty.
  const [filed, setFiled] = useState<string | null>(null)
  // Reused while the content is unchanged, so a retry after a lost response files one ticket.
  const attempt = useRef<{ id: string; signature: string } | null>(null)

  const dirty = !filed && (title.trim() !== "" || body.trim() !== "" || files.length > 0)
  useUnsaved(dirty)
  useEffect(() => {
    if (filed) navigate(supportPath(org, `/${filed}`), { replace: true })
  }, [filed, navigate, org])

  function chooseType(next: TicketType) {
    setType(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const valid = files.filter((entry) => !entry.error).map((entry) => entry.file)
    const description = body.trim() === "" ? "" : body
    const signature = JSON.stringify([type, title, description, valid.map((file) => [file.name, file.size])])
    if (attempt.current?.signature !== signature) attempt.current = { id: clientId(), signature }
    setBusy(true)
    setError(undefined)
    try {
      const ticket = await api.fileTicket(org, { client_id: attempt.current.id, type, title, body: description, context }, valid)
      void cache.invalidateQueries({ queryKey: ["tickets", org] })
      toast.success(`Ticket #${ticket.number} filed. The platform team will reply here.`)
      setFiled(ticket.uuid)
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  const blocked = files.some((entry) => entry.error)
  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <PageHeader title="New ticket" back={{ to: supportPath(org), label: "Support" }} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <Panel className="max-w-form">
          <PanelContent>
            <FieldGroup>
              <FieldSet>
                <FieldLegend>What kind of ticket?</FieldLegend>
                <RadioGroup value={type} onValueChange={(value) => chooseType(value as TicketType)} className="grid gap-3 md:grid-cols-3">
                  {types.map((option) => (
                    <ChoiceCard key={option.value} value={option.value} title={option.title} description={option.description} icon={option.icon} disabled={busy} />
                  ))}
                </RadioGroup>
              </FieldSet>
              <TextField
                label="Title"
                value={title}
                maxLength={150}
                autoComplete="off"
                placeholder={type === "bug" ? "Devices page shows no readings" : "Export dashboards as PDF"}
                help="One line that says what it is about."
                error={fieldError(error, "title")}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Field data-invalid={Boolean(fieldError(error, "body"))}>
                <FieldLabel htmlFor="ticket-description">Description</FieldLabel>
                <Composer
                  field
                  id="ticket-description"
                  label="Description"
                  value={body}
                  onValueChange={setBody}
                  files={files}
                  onFilesChange={setFiles}
                  disabled={busy}
                  invalid={Boolean(fieldError(error, "body"))}
                  placeholder={ticketGuidance[type]}
                  hint="Paste or drop screenshots and PDFs, 10 MB each"
                />
                <FieldError>{fieldError(error, "body")}</FieldError>
              </Field>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="link" size="sm" className="h-auto px-0 text-muted-foreground">
                    What else is included with your report?
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <PropertyList
                    items={[
                      { label: "Page", value: <span className="font-mono text-code break-all">{context.path ?? "Unknown"}</span> },
                      { label: "Browser", value: <span className="break-all">{context.user_agent}</span> },
                      { label: "Screen", value: context.screen },
                      { label: "Time zone", value: context.time_zone ?? "Unknown" },
                    ]}
                  />
                </CollapsibleContent>
              </Collapsible>
              <RequestError error={fieldError(error, "title") || fieldError(error, "body") ? undefined : error} />
            </FieldGroup>
          </PanelContent>
        </Panel>
      </div>
      <div
        ref={keepToastsAbove}
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3 md:px-6"
      >
        <p className="mr-auto text-meta text-muted-foreground" aria-live="polite">
          The platform team and anyone you tag later can read this ticket.
        </p>
        <Button type="button" variant="outline" disabled={busy} asChild>
          <Link to={supportPath(org)}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={busy || title.trim().length < 3 || blocked}>
          {busy ? "Filing…" : "File ticket"}
        </Button>
      </div>
    </form>
  )
}
