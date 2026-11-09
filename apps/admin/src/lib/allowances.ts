import type { AllowanceKind, PlanAllowance } from "@iot-os/api-client"

/** Every allowance kind, in the API's order (ADR-035). */
export const allowanceKinds: AllowanceKind[] = ["alerts", "sms", "devices", "data_points", "retention_days", "organizations"]

type KindText = {
  /** Field and row label. */
  label: string
  /** Compact list label: "Alerts 3 · SMS 2". */
  short: string
  /** History field label: "Changed the alert allowance from 3 to 5". */
  noun: string
  help: string
}

export const allowanceText: Record<AllowanceKind, KindText> = {
  alerts: {
    label: "Alerts per month",
    short: "Alerts",
    noun: "alert allowance",
    help: "Automation alert activations per calendar month (UTC). Going over never stops an alert.",
  },
  sms: { label: "SMS per month", short: "SMS", noun: "SMS allowance", help: "SMS parts sent per calendar month (UTC)." },
  devices: { label: "Active devices", short: "Devices", noun: "device allowance", help: "Devices active at once." },
  data_points: {
    label: "Data points per month",
    short: "Data points",
    noun: "data point allowance",
    help: "Stored readings per calendar month (UTC).",
  },
  retention_days: {
    label: "Telemetry retention",
    short: "Retention",
    noun: "retention",
    help: "Days of telemetry history, from 1 to 36,500.",
  },
  organizations: {
    label: "Organizations",
    short: "Organizations",
    noun: "organization limit",
    help: "Organizations the account's owners may create. Platform administrators can always add more.",
  },
}

/** The highest value the API accepts for each kind. */
export const allowanceMaximum: Record<AllowanceKind, number> = {
  alerts: 1_000_000_000_000,
  sms: 1_000_000_000_000,
  devices: 1_000_000_000_000,
  data_points: 1_000_000_000_000,
  retention_days: 36_500,
  organizations: 100_000,
}

/** Retention is never unlimited: null there means the platform's retention setting. */
export const allowsUnlimited = (kind: AllowanceKind) => kind !== "retention_days"

/** A value as text: a number, "Unlimited", or the platform retention setting, in days when known. */
export function allowanceValue(kind: AllowanceKind, value: number | null, platformRetentionDays?: number): string {
  const days = (count: number) => `${count.toLocaleString()} ${count === 1 ? "day" : "days"}`
  if (value === null && allowsUnlimited(kind)) return "Unlimited"
  if (value === null) return platformRetentionDays === undefined ? "Platform setting" : `${days(platformRetentionDays)} (platform setting)`
  return kind === "retention_days" ? days(value) : value.toLocaleString()
}

/** "Alerts 3 · SMS 2 · Devices Unlimited", or "Deployment defaults" when the plan sets none. */
export function allowanceSummary(allowances: PlanAllowance[]): string {
  if (!allowances.length) return "Deployment defaults"
  return allowanceKinds
    .flatMap((kind) => allowances.filter((allowance) => allowance.kind === kind))
    .map((allowance) => `${allowanceText[allowance.kind].short} ${allowanceValue(allowance.kind, allowance.value)}`)
    .join(" · ")
}

/** History labels for account and plan fields, allowances included. */
export const historyFieldLabels: Record<string, string> = {
  name: "name",
  description: "description",
  contact_email: "contact email",
  notes: "notes",
  plan: "plan",
  trial: "trial",
  organization_limit: "organization limit",
  ...Object.fromEntries(allowanceKinds.map((kind) => [kind, allowanceText[kind].noun])),
  // Prices and billing details (spec 029 US6).
  base_price: "base price",
  alert_overage_price: "price per alert over the allowance",
  data_point_overage_price: "price per block of data points",
  data_point_block_size: "data point block size",
  billing_address: "billing address",
  tax_number: "tax number",
  tax_rate: "tax rate",
}

/** "name from A to B, alert allowance from 3 to 5"; an empty plan reads "no plan". */
export function changesText(changes: { field: string; from: string | null; to: string | null }[] = []): string {
  const empty = (field: string) => (field === "plan" ? "no plan" : "empty")
  return changes
    .map(
      (change) =>
        `${historyFieldLabels[change.field] ?? change.field} from ${change.from ?? empty(change.field)} to ${change.to ?? empty(change.field)}`,
    )
    .join(", ")
}
