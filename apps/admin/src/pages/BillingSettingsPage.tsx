import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { ApiError, type BillingSettings, type TaxRate } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { DropdownMenuItem } from "@iot-os/ui/components/dropdown-menu"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { FieldGroup } from "@iot-os/ui/components/field"
import { TextareaField, TextField, ValueField } from "@iot-os/ui/components/form-fields"
import { RelativeTime } from "@iot-os/ui/components/freshness"
import { PageHeader } from "@iot-os/ui/components/page-header"
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatBasisPoints } from "@iot-os/ui/lib/money"
import { AlertCircleIcon, PercentIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { TaxRateDialog } from "../components/TaxRateDialog"
import { useDiscardGuard } from "../hooks/use-discard-guard"
import { apiClient } from "../lib/api-client"
import { errorMessage, fieldMessages, validationErrors } from "../lib/errors"

type Form = {
  legal_name: string
  address: string
  tax_registration_number: string
  invoice_footer: string
  invoice_prefix: string
  credit_note_prefix: string
}

const formFrom = (settings: BillingSettings): Form => ({
  legal_name: settings.legal_name ?? "",
  address: settings.address ?? "",
  tax_registration_number: settings.tax_registration_number ?? "",
  invoice_footer: settings.invoice_footer ?? "",
  invoice_prefix: settings.invoice_prefix,
  credit_note_prefix: settings.credit_note_prefix,
})

const blankToNull = (value: string) => value.trim() || null

/**
 * Billing settings (spec 029 FR-029): the operator's details printed on every invoice,
 * the number prefixes, and the named tax rates accounts are given. The currency is the
 * deployment's.
 */
export function BillingSettingsPage() {
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null)
  const [saving, setSaving] = useState(false)
  const [rates, setRates] = useState<TaxRate[] | null>(null)
  const [ratesFailed, setRatesFailed] = useState(false)
  const [editingRate, setEditingRate] = useState<TaxRate | "new" | null>(null)
  const saved = settings ? formFrom(settings) : null
  const dirty = Boolean(form && saved && (Object.keys(saved) as (keyof Form)[]).some((key) => form[key] !== saved[key]))
  const { dialog: discardDialog } = useDiscardGuard(dirty, {
    title: "Discard unsaved billing settings?",
    description: "The saved settings stay as they are.",
  })

  const loadSettings = useCallback(() => {
    setLoadFailed(false)
    return apiClient
      .billingSettings()
      .then((loaded) => {
        setSettings(loaded)
        setForm(formFrom(loaded))
        setConflict(false)
      })
      .catch(() => setLoadFailed(true))
  }, [])

  const loadRates = useCallback(() => {
    setRatesFailed(false)
    apiClient
      .taxRates()
      .then(setRates)
      .catch(() => setRatesFailed(true))
  }, [])

  useEffect(() => {
    void loadSettings()
    loadRates()
  }, [loadSettings, loadRates])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings || !form) return
    setSaving(true)
    setErrors(null)
    try {
      const next = await apiClient.updateBillingSettings({
        revision: settings.revision,
        legal_name: blankToNull(form.legal_name),
        address: blankToNull(form.address),
        tax_registration_number: blankToNull(form.tax_registration_number),
        invoice_footer: blankToNull(form.invoice_footer),
        invoice_prefix: form.invoice_prefix.trim(),
        credit_note_prefix: form.credit_note_prefix.trim(),
      })
      setSettings(next)
      setForm(formFrom(next))
      toast.success("Billing settings saved")
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true)
      else {
        const fields = validationErrors(error)
        setErrors(fields)
        if (!fields) toast.error(errorMessage(error))
      }
    } finally {
      setSaving(false)
    }
  }

  async function archive(rate: TaxRate) {
    try {
      await apiClient.archiveTaxRate(rate.uuid)
      toast.success(`${rate.name} archived. Accounts that have it keep it.`)
      loadRates()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const rateColumns = useMemo<DataColumn<TaxRate>[]>(
    () => [
      {
        id: "name",
        header: "Tax rate",
        mobile: "title",
        value: (rate) => rate.name,
        cell: (rate) => <span className="font-medium">{rate.name}</span>,
      },
      {
        id: "percentage",
        header: "Rate",
        hideable: false,
        align: "end",
        value: (rate) => rate.basis_points,
        cell: (rate) => <span className="tabular-nums">{formatBasisPoints(rate.basis_points)}</span>,
      },
      {
        id: "status",
        header: "Status",
        mobile: "badge",
        hideable: false,
        value: (rate) => (rate.archived ? "archived" : "active"),
        cell: (rate) => <Status value={rate.archived ? "archived" : "active"} />,
      },
    ],
    [],
  )

  const field = (key: string) => fieldMessages(errors, key)?.join(" ")
  const set = (key: keyof Form) => (event: { target: { value: string } }) =>
    setForm((current) => (current ? { ...current, [key]: event.target.value } : current))

  return (
    <>
      <PageHeader title="Billing" />
      <div className="flex w-full max-w-4xl flex-col gap-(--panel-gap) p-4 md:p-6">
        {loadFailed ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not load the billing settings</AlertTitle>
            <AlertDescription>
              <Button variant="outline" size="sm" onClick={() => void loadSettings()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <Panel aria-labelledby="billing-operator">
          <PanelHeader>
            <PanelTitle id="billing-operator">Operator details</PanelTitle>
            <PanelDescription>Printed on every invoice and credit note when it is issued.</PanelDescription>
          </PanelHeader>
          {!form || !settings ? (
            <PanelContent className="flex flex-col gap-3" aria-busy="true">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </PanelContent>
          ) : (
            <form onSubmit={save}>
              <PanelContent>
                <FieldGroup className="max-w-form">
                  {conflict ? (
                    <Alert variant="destructive">
                      <AlertCircleIcon />
                      <AlertTitle>Someone else saved these settings</AlertTitle>
                      <AlertDescription>
                        Load what they saved, then make your changes again.
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadSettings()}>
                          Load saved settings
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <TextField label="Legal name" value={form.legal_name} maxLength={255} optional error={field("legal_name")} onChange={set("legal_name")} />
                  <TextareaField label="Address" value={form.address} maxLength={1000} rows={3} optional error={field("address")} onChange={set("address")} />
                  <TextField
                    label="Tax registration number"
                    value={form.tax_registration_number}
                    maxLength={64}
                    optional
                    error={field("tax_registration_number")}
                    onChange={set("tax_registration_number")}
                  />
                  <TextareaField
                    label="Invoice footer"
                    value={form.invoice_footer}
                    maxLength={2000}
                    rows={2}
                    optional
                    help="Such as payment terms or bank details."
                    error={field("invoice_footer")}
                    onChange={set("invoice_footer")}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Invoice number prefix"
                      value={form.invoice_prefix}
                      maxLength={16}
                      required
                      help={`Next numbers read ${form.invoice_prefix || ""}0001 and on.`}
                      error={field("invoice_prefix")}
                      onChange={set("invoice_prefix")}
                    />
                    <TextField
                      label="Credit note number prefix"
                      value={form.credit_note_prefix}
                      maxLength={16}
                      required
                      error={field("credit_note_prefix")}
                      onChange={set("credit_note_prefix")}
                    />
                  </div>
                  <ValueField
                    label="Currency"
                    value={settings.currency}
                    help="Every price and invoice is in the deployment's currency, set when it is installed."
                  />
                </FieldGroup>
              </PanelContent>
              <PanelFooter className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={!dirty || saving || conflict}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
                {settings.updated_at ? (
                  <span className="text-meta text-muted-foreground">
                    Saved <RelativeTime at={settings.updated_at} />
                  </span>
                ) : null}
              </PanelFooter>
            </form>
          )}
        </Panel>
        <Panel aria-labelledby="billing-tax-rates">
          <PanelHeader>
            <PanelTitle id="billing-tax-rates">Tax rates</PanelTitle>
            <PanelDescription>Give each billing account one on its page. Archived rates stay on the accounts that have them.</PanelDescription>
            <PanelActions>
              <Button size="sm" variant="outline" onClick={() => setEditingRate("new")}>
                <PlusIcon data-icon="inline-start" />
                Add tax rate
              </Button>
            </PanelActions>
          </PanelHeader>
          <PanelContent flush>
            <DataTable
              id="admin-tax-rates"
              label="Tax rates"
              noun={["tax rate", "tax rates"]}
              rowKey={(rate) => rate.uuid}
              rowLabel={(rate) => rate.name}
              columns={rateColumns}
              rows={rates ?? undefined}
              error={
                ratesFailed ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertDescription>Could not load the tax rates. Reload the page.</AlertDescription>
                  </Alert>
                ) : undefined
              }
              rowActions={(rate) =>
                rate.archived ? (
                  <DropdownMenuItem disabled>Archived rates cannot be changed</DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onSelect={() => setEditingRate(rate)}>Edit tax rate</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void archive(rate)}>Archive tax rate</DropdownMenuItem>
                  </>
                )
              }
              empty={
                <EmptyState
                  inset
                  icon={<PercentIcon />}
                  title="No tax rates yet"
                  description="Without a tax rate, invoices charge no tax."
                />
              }
            />
          </PanelContent>
        </Panel>
      </div>
      <TaxRateDialog rate={editingRate} onClose={() => setEditingRate(null)} onSaved={loadRates} />
      {discardDialog}
    </>
  )
}
