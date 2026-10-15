import { useEffect, useId, useState } from "react"
import {
  ApiError,
  type AssistantAdminSettings,
  type AssistantConnectionTest,
  type AssistantProviderOption,
} from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Badge } from "@iot-os/ui/components/badge"
import { Button } from "@iot-os/ui/components/button"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { Input } from "@iot-os/ui/components/input"
import { PageHeader } from "@iot-os/ui/components/page-header"
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { RadioGroup } from "@iot-os/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { toast } from "sonner"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"

// A large reply: a long conversation with context, and a detailed answer.
const LARGE_REPLY = { input: 15000, output: 2000 }

type Form = { provider: string; model: string; daily: string; run: string; key: string }

function formFrom(settings: AssistantAdminSettings): Form {
  return {
    provider: settings.provider,
    model: settings.model,
    daily: String(settings.daily_budget_usd),
    run: String(settings.run_budget_usd),
    key: "",
  }
}

function usd(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.1 ? 3 : 2,
  })
}

function message(error: unknown) {
  if (error instanceof ApiError)
    return (
      (error.payload as { message?: string })?.message ??
      "This change could not be saved."
    )
  return error instanceof Error ? error.message : "The service could not be reached."
}

function fieldErrors(error: unknown): Record<string, string | undefined> {
  if (!(error instanceof ApiError) || error.status !== 422) return {}
  const errors = (error.payload as { errors?: Record<string, string[]> })?.errors ?? {}
  return Object.fromEntries(Object.entries(errors).map(([field, list]) => [field, list[0]]))
}

function keyStatus(provider: AssistantProviderOption) {
  const ending = provider.key.last_four ? ` ending in …${provider.key.last_four}` : ""
  if (provider.key.source === "saved") return `Saved key${ending}`
  if (provider.key.source === "environment") return `Server environment key${ending}`
  return "No key yet"
}

export function AssistantPage() {
  const id = useId()
  const [settings, setSettings] = useState<AssistantAdminSettings | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<(AssistantConnectionTest & { label: string }) | null>(null)
  const [removing, setRemoving] = useState<AssistantProviderOption | null>(null)

  function apply(value: AssistantAdminSettings) {
    setSettings(value)
    setForm(formFrom(value))
  }

  useEffect(() => {
    let current = true
    apiClient
      .assistantAdminSettings()
      .then((value) => {
        if (current) apply(value)
      })
      .catch((reason) => {
        if (current) setError(reason)
      })
    return () => {
      current = false
    }
  }, [])

  const saved = settings ? formFrom(settings) : null
  const dirty = Boolean(
    form &&
      saved &&
      (form.provider !== saved.provider ||
        form.model !== saved.model ||
        Number(form.daily) !== Number(saved.daily) ||
        Number(form.run) !== Number(saved.run) ||
        form.key.trim() !== ""),
  )
  const { dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard unsaved assistant settings?",
    description: "The saved provider, model, key and limits will remain unchanged.",
  })

  const provider = settings?.providers.find((option) => option.id === form?.provider)
  const model = provider?.models.find((option) => option.id === form?.model)
  const estimate = model
    ? (LARGE_REPLY.input * model.input_usd_per_million +
        LARGE_REPLY.output * model.output_usd_per_million) /
      1_000_000
    : null
  const runLimit = Number(form?.run)
  const errors = fieldErrors(error)

  function chooseProvider(value: string) {
    if (!settings || !form) return
    const next = settings.providers.find((option) => option.id === value)
    if (!next) return
    setForm({
      ...form,
      provider: value,
      model: value === settings.provider ? settings.model : next.default_model,
      key: "",
    })
    setTest(null)
  }

  async function save() {
    if (!settings || !form || busy) return
    setBusy(true)
    setError(null)
    try {
      apply(
        await apiClient.updateAssistantAdminSettings({
          provider: form.provider,
          model: form.model,
          daily_budget_usd: Number(form.daily),
          run_budget_usd: Number(form.run),
          revision: settings.revision,
          ...(form.key.trim() ? { api_key: form.key.trim() } : {}),
        }),
      )
      setTest(null)
      toast.success("AI assistant settings saved")
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    if (!form || !provider || testing) return
    setTesting(true)
    setTest(null)
    try {
      const result = await apiClient.testAssistantConnection({
        provider: form.provider,
        model: form.model,
        ...(form.key.trim() ? { api_key: form.key.trim() } : {}),
      })
      setTest({ ...result, label: `${provider.label} · ${model?.label ?? form.model}` })
    } catch (reason) {
      setTest({ ok: false, latency_ms: null, error: message(reason), label: provider.label })
    } finally {
      setTesting(false)
    }
  }

  async function removeKey() {
    if (!removing || busy) return
    setBusy(true)
    setError(null)
    try {
      apply(await apiClient.removeAssistantProviderKey(removing.id))
      toast.success(`${removing.label} key removed`)
      setRemoving(null)
    } catch (reason) {
      setError(reason)
      setRemoving(null)
    } finally {
      setBusy(false)
    }
  }

  async function reload() {
    try {
      apply(await apiClient.assistantAdminSettings())
      setError(null)
    } catch (reason) {
      setError(reason)
    }
  }

  return (
    <>
      <PageHeader title="AI assistant" />
      <div className="flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
        {Boolean(error) && (
          <Alert variant="destructive">
            <AlertTitle>Settings need attention</AlertTitle>
            <AlertDescription>
              {message(error)}
              {error instanceof ApiError && error.status === 409 && (
                <Button variant="outline" disabled={busy} onClick={reload}>
                  Load saved settings
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {settings && !settings.enabled && (
          <Alert>
            <AlertTitle>The assistant is switched off on this server</AlertTitle>
            <AlertDescription>
              Settings saved here apply once the server sets IOT_ASSISTANT_ENABLED=true.
            </AlertDescription>
          </Alert>
        )}
        {!settings && !error && (
          <p role="status" className="text-body text-muted-foreground">
            Loading assistant settings…
          </p>
        )}
        {settings && form && (
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <Panel>
              <PanelHeader>
                <PanelTitle id={`${id}-provider`}>Provider</PanelTitle>
                <PanelDescription>
                  Every organization&apos;s assistant, Ask Help and telemetry diagnosis use it.
                </PanelDescription>
              </PanelHeader>
              <PanelContent>
                <RadioGroup
                  aria-labelledby={`${id}-provider`}
                  value={form.provider}
                  onValueChange={chooseProvider}
                  disabled={busy}
                  className="gap-2"
                >
                  {settings.providers.map((option) => (
                    <ChoiceCard
                      key={option.id}
                      value={option.id}
                      title={option.label}
                      description={keyStatus(option)}
                      badge={
                        option.id === settings.provider ? (
                          <Badge variant="success">In use</Badge>
                        ) : undefined
                      }
                    />
                  ))}
                </RadioGroup>
              </PanelContent>
            </Panel>

            {provider && (
              <Panel>
                <PanelHeader>
                  <PanelTitle>Model</PanelTitle>
                  <PanelDescription>Prices are per million tokens.</PanelDescription>
                </PanelHeader>
                <PanelContent>
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.model) || undefined}>
                      <FieldLabel htmlFor={`${id}-model`}>{provider.label} model</FieldLabel>
                      {/* Remount per provider: Radix keeps the old label when the options change. */}
                      <Select
                        key={provider.id}
                        value={form.model}
                        onValueChange={(value) => setForm({ ...form, model: value })}
                        disabled={busy}
                      >
                        <SelectTrigger id={`${id}-model`} className="w-full max-w-md">
                          <SelectValue placeholder="Choose a model" />
                        </SelectTrigger>
                        <SelectContent>
                          {provider.models.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.label}
                              <span className="text-muted-foreground tabular-nums">
                                {usd(option.input_usd_per_million)} in ·{" "}
                                {usd(option.output_usd_per_million)} out
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {estimate !== null && (
                        <FieldDescription>
                          A large reply (about 15,000 tokens in and 2,000 out) costs about{" "}
                          <span className="tabular-nums">{usd(estimate)}</span>. Thinking
                          tokens count as output.
                        </FieldDescription>
                      )}
                      <FieldError>{errors.model}</FieldError>
                    </Field>
                  </FieldGroup>
                  {estimate !== null && runLimit > 0 && estimate > runLimit && (
                    <Alert className="mt-4">
                      <AlertTitle>Large replies may stop early</AlertTitle>
                      <AlertDescription>
                        A large reply on this model costs more than the per-reply limit of{" "}
                        {usd(runLimit)}. Raise the limit under Spend limits, or choose a
                        smaller model.
                      </AlertDescription>
                    </Alert>
                  )}
                </PanelContent>
              </Panel>
            )}

            {provider && (
              <Panel>
                <PanelHeader>
                  <PanelTitle>{provider.label} API key</PanelTitle>
                  <PanelDescription>
                    {keyStatus(provider)}
                    {provider.key.updated_at && (
                      <>
                        {" "}· saved <RelativeTime at={provider.key.updated_at} />
                      </>
                    )}
                  </PanelDescription>
                </PanelHeader>
                <PanelContent className="flex flex-col gap-4">
                  <Field data-invalid={Boolean(errors.api_key) || undefined}>
                    <FieldLabel htmlFor={`${id}-key`}>
                      {provider.key.source ? "Replace key" : "API key"}
                    </FieldLabel>
                    <Input
                      id={`${id}-key`}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={form.key}
                      disabled={busy}
                      placeholder={provider.key.source ? "Leave empty to keep the current key" : "Paste the key"}
                      onChange={(event) => {
                        setForm({ ...form, key: event.target.value })
                        setTest(null)
                      }}
                      className={form.key ? "max-w-md font-mono" : "max-w-md"}
                    />
                    <FieldDescription>
                      Stored encrypted. It is never shown again; only its last four characters are.
                    </FieldDescription>
                    <FieldError>{errors.api_key}</FieldError>
                  </Field>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={testing || busy || (!form.key.trim() && !provider.key.source)}
                      onClick={testConnection}
                    >
                      {testing ? "Testing…" : "Test connection"}
                    </Button>
                    {provider.key.source === "saved" && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setRemoving(provider)}
                      >
                        Remove saved key
                      </Button>
                    )}
                  </div>
                  {test && (
                    <Alert variant={test.ok ? "default" : "destructive"} aria-live="polite">
                      <AlertTitle>{test.ok ? "Connected" : "Connection failed"}</AlertTitle>
                      <AlertDescription>
                        {test.ok
                          ? `${test.label} answered in ${test.latency_ms?.toLocaleString()} ms. Nothing was saved.`
                          : test.error}
                      </AlertDescription>
                    </Alert>
                  )}
                </PanelContent>
              </Panel>
            )}

            <Panel>
              <PanelHeader>
                <PanelTitle>Spend limits</PanelTitle>
                <PanelDescription>
                  Shared by every organization. Spent today:{" "}
                  <span className="tabular-nums">{usd(settings.today.spent_usd)}</span>
                  {settings.today.reserved_usd > 0 && (
                    <>
                      {" "}plus{" "}
                      <span className="tabular-nums">{usd(settings.today.reserved_usd)}</span>{" "}
                      held for replies in progress
                    </>
                  )}
                  .
                </PanelDescription>
              </PanelHeader>
              <PanelContent>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={Boolean(errors.daily_budget_usd) || undefined}>
                    <FieldLabel htmlFor={`${id}-daily`}>Daily limit (USD)</FieldLabel>
                    <Input
                      id={`${id}-daily`}
                      type="number"
                      required
                      min={0.01}
                      max={10000}
                      step={0.01}
                      value={form.daily}
                      disabled={busy}
                      onChange={(event) => setForm({ ...form, daily: event.target.value })}
                      className="max-w-40 tabular-nums"
                    />
                    <FieldDescription>New replies are refused once it is reached.</FieldDescription>
                    <FieldError>{errors.daily_budget_usd}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(errors.run_budget_usd) || undefined}>
                    <FieldLabel htmlFor={`${id}-run`}>Per-reply limit (USD)</FieldLabel>
                    <Input
                      id={`${id}-run`}
                      type="number"
                      required
                      min={0.001}
                      max={1000}
                      step={0.001}
                      value={form.run}
                      disabled={busy}
                      onChange={(event) => setForm({ ...form, run: event.target.value })}
                      className="max-w-40 tabular-nums"
                    />
                    <FieldDescription>Held when a reply starts; a reply that costs more stops.</FieldDescription>
                    <FieldError>{errors.run_budget_usd}</FieldError>
                  </Field>
                </FieldGroup>
              </PanelContent>
            </Panel>

            <p className="text-meta text-muted-foreground">
              These are the platform&apos;s own limits, not the provider&apos;s billing caps. Keep a
              spend limit in the provider&apos;s console too.
            </p>
            <div className="flex gap-3">
              <Button disabled={!dirty || busy}>{busy ? "Saving…" : "Save settings"}</Button>
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || busy}
                onClick={() => {
                  apply(settings)
                  setTest(null)
                  setError(null)
                }}
              >
                Discard edits
              </Button>
            </div>
          </form>
        )}
      </div>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the saved {removing?.label} key?</AlertDialogTitle>
            <AlertDialogDescription>
              The platform deletes its copy. {removing?.label} then uses the server environment key,
              if there is one. Revoke the key in {removing?.label}&apos;s console as well if it
              should stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={removeKey}>
              Remove key
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {discardDialog}
    </>
  )
}
