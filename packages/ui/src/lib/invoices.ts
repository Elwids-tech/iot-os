/** Invoice wording shared by admin and portal (spec 029 US6). */

/** A UTC month as a name: "2026-11-01" or "2026-11" → "November 2026". */
export function formatMonth(month: string): string {
  const [year, number] = month.split("-").map(Number)
  if (!year || !number) return month
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** A UTC date without the time: "2026-11-16T10:00:00+00:00" → "16 Nov 2026" in the reader's locale. */
export function formatDay(at: string): string {
  const time = Date.parse(at)
  if (Number.isNaN(time)) return at
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

/**
 * What a `payment` Status shows for an invoice: its payment status, or `overdue` once
 * an issued invoice still awaiting payment is past its due date. Drafts have none.
 */
export function paymentState(
  invoice: { status: string; payment_status: string; due_at: string | null },
  now: number = Date.now(),
): string | null {
  if (invoice.status !== "issued") return null
  if (invoice.payment_status === "pending" && invoice.due_at && Date.parse(invoice.due_at) < now) return "overdue"
  return invoice.payment_status
}
