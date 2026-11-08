/**
 * Trial dates shared by admin and portal (spec 029 US8). A trial ends at an instant;
 * invoices charge each day by the assignment in force at 00:00 UTC, so one ending at
 * 00:00 UTC on the 9th runs until the 8th, its last day, and is charged from the 9th.
 */

import { formatDay } from "./invoices"

const DAY = 86_400_000

/** The UTC day a trial ending at `endsAt` runs until: "2026-12-09T00:00:00Z" → "2026-12-08". */
export function trialLastDay(endsAt: string): string {
  const time = Date.parse(endsAt)
  if (Number.isNaN(time)) return endsAt
  return new Date(time - 1).toISOString().slice(0, 10)
}

/** When a trial whose last UTC day is `lastDay` ends: "2026-12-08" → "2026-12-09T00:00:00.000Z". */
export function trialEndsAt(lastDay: string): string {
  return new Date(Date.parse(`${lastDay}T00:00:00Z`) + DAY).toISOString()
}

/** "Trial until 8 Dec 2026", "Trial, no end date", or "Trial ended, no payment method"; null for a paid plan. */
export function trialText(plan: { kind: string; trial_ends_at: string | null }): string | null {
  if (plan.kind === "trial_unpaid") return "Trial ended, no payment method"
  if (plan.kind !== "trial") return null
  return plan.trial_ends_at ? `Trial until ${formatDay(trialLastDay(plan.trial_ends_at))}` : "Trial, no end date"
}

/** Whether a limited trial ends within 7 days, as the reminders and the admin filter count it. */
export function trialEndingSoon(plan: { kind: string; trial_ends_at: string | null }, now: number = Date.now()): boolean {
  if (plan.kind !== "trial" || !plan.trial_ends_at) return false
  return Date.parse(plan.trial_ends_at) - now <= 7 * DAY
}
