import type { BillingAccountSummary, DirectoryQuery } from "@iot-os/api-client"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import { RadioGroup } from "@iot-os/ui/components/radio-group"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { InfoIcon } from "lucide-react"
import { useSearchOptions } from "../hooks/use-search-options"
import { apiClient } from "../lib/api-client"
import { fieldMessages } from "../lib/errors"

export type BillingAccountChoiceValue = {
  mode: "new" | "existing"
  /** New account: its name follows the organization's until edited. */
  name: string
  nameTouched: boolean
  contactEmail: string
  /** Existing account. */
  account: BillingAccountSummary | null
}

export const newBillingAccountChoice = (): BillingAccountChoiceValue => ({
  mode: "new",
  name: "",
  nameTouched: false,
  contactEmail: "",
  account: null,
})

/** What `createAdminOrganization` sends for the choice. */
export function billingAccountValues(choice: BillingAccountChoiceValue, organizationName: string) {
  return choice.mode === "existing"
    ? { billing_account_uuid: choice.account?.uuid }
    : {
        new_billing_account: {
          name: choice.name.trim() || organizationName.trim(),
          contact_email: choice.contactEmail.trim() || null,
        },
      }
}

function loadAccounts(query: DirectoryQuery) {
  return apiClient.adminBillingAccounts(query)
}

export const atLimit = (account: Pick<BillingAccountSummary, "organizations_count" | "organization_limit">) =>
  account.organizations_count >= account.organization_limit

/** "1 of 10 organizations", or "3 organizations, limit 1" once a platform administrator went past it. */
export function organizationsOfLimit(account: Pick<BillingAccountSummary, "organizations_count" | "organization_limit">) {
  const { organizations_count: count, organization_limit: limit } = account
  return count > limit
    ? `${count} ${count === 1 ? "organization" : "organizations"}, limit ${limit}`
    : `${count} of ${limit} ${limit === 1 ? "organization" : "organizations"}`
}

/**
 * The billing account a new organization belongs to (spec 023): a new account,
 * named after the organization unless edited, or an existing one found by name.
 */
export function BillingAccountChoice({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: BillingAccountChoiceValue
  onChange: (value: BillingAccountChoiceValue) => void
  errors: Record<string, string[]> | null
  disabled?: boolean
}) {
  const accounts = useSearchOptions(loadAccounts, value.mode === "existing")
  const nameErrors = fieldMessages(errors, "new_billing_account.name")
  const emailErrors = fieldMessages(errors, "new_billing_account.contact_email")
  const accountErrors = fieldMessages(errors, "billing_account_uuid")

  return (
    <FieldSet>
      <FieldLegend variant="label">Billing account</FieldLegend>
      <RadioGroup
        value={value.mode}
        onValueChange={(mode) => onChange({ ...value, mode: mode as BillingAccountChoiceValue["mode"] })}
        disabled={disabled}
        className="gap-2"
      >
        <ChoiceCard value="new" title="New billing account" description="This organization is its own customer." />
        <ChoiceCard
          value="existing"
          title="Existing billing account"
          description="Another organization of a customer who already pays for one."
        />
      </RadioGroup>
      {value.mode === "new" ? (
        <FieldGroup>
          <Field data-invalid={Boolean(nameErrors)}>
            <FieldLabel htmlFor="billing-account-name">Account name</FieldLabel>
            <Input
              id="billing-account-name"
              value={value.name}
              autoComplete="off"
              maxLength={255}
              disabled={disabled}
              aria-invalid={Boolean(nameErrors)}
              onChange={(event) => onChange({ ...value, name: event.target.value, nameTouched: true })}
            />
            <FieldError errors={nameErrors?.map((message) => ({ message }))} />
          </Field>
          <Field data-invalid={Boolean(emailErrors)}>
            <FieldLabel htmlFor="billing-account-email">
              Billing contact email <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="billing-account-email"
              type="email"
              value={value.contactEmail}
              autoComplete="off"
              maxLength={255}
              disabled={disabled}
              aria-invalid={Boolean(emailErrors)}
              onChange={(event) => onChange({ ...value, contactEmail: event.target.value })}
            />
            <FieldError errors={emailErrors?.map((message) => ({ message }))} />
          </Field>
        </FieldGroup>
      ) : (
        <FieldGroup>
          <SearchableSelect
            label="Account"
            value={value.account?.uuid ?? ""}
            selectedLabel={value.account?.name}
            placeholder="Choose a billing account"
            emptyText={accounts.failed ? "Billing accounts could not be loaded." : "No billing accounts match."}
            disabled={disabled}
            {...accounts.select}
            options={accounts.items.map((account) => ({
              value: account.uuid,
              label: `${account.name} · ${organizationsOfLimit(account)}`,
            }))}
            onChange={(uuid) =>
              onChange({ ...value, account: accounts.items.find((account) => account.uuid === uuid) ?? null })
            }
            error={accountErrors?.join(" ")}
          />
          {value.account && atLimit(value.account) ? (
            <Alert>
              <InfoIcon />
              <AlertDescription>
                {value.account.name} already has {organizationsOfLimit(value.account)}. You can still add this one;
                its owners cannot add more until the limit is raised.
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      )}
    </FieldSet>
  )
}
