/**
 * A pending retention reduction (spec 029 FR-020, FR-022). After a billing change
 * shortens retention, cleanup keeps the longer period through a 30-day grace; two
 * changes within it step down twice, once as each grace ends.
 */

import { formatDateTime, formatNumber } from "./format"

/** Cleanup keeps `days` from `from`. */
export type RetentionStep = { days: number; from: string }

/** The steps cleanup takes, earliest first. A payload without `steps` carries only its last one. */
export function reductionSteps(reduction: RetentionStep & { steps?: RetentionStep[] }): RetentionStep[] {
  return reduction.steps?.length ? reduction.steps : [{ days: reduction.days, from: reduction.from }]
}

/** "30 days from 8 Dec 2026, then 7 days from 13 Dec 2026". */
export function reductionText(
  reduction: RetentionStep & { steps?: RetentionStep[] },
  format: (iso: string) => string = formatDateTime,
): string {
  return reductionSteps(reduction)
    .map((step, index) => `${index === 0 ? "" : "then "}${days(step.days)} from ${format(step.from)}`)
    .join(", ")
}

const days = (value: number) => `${formatNumber(value)} ${value === 1 ? "day" : "days"}`
