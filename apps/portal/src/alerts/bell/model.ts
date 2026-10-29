import type { AlertNotificationSummary } from "@iot-os/api-client";

export const alertBellKeys = {
  summary: (org: string) => ["alert-notification-summary", org] as const,
  list: (org: string) => ["alert-notifications", org] as const,
};

/** Polling: every 15 s while the tab is visible, every 60 s while hidden (spec 022, FR-009). */
export const pollInterval = (visibility: DocumentVisibilityState) => (visibility === "hidden" ? 60_000 : 15_000);

/**
 * `baseline` is the newest activation this page has accounted for: the backlog at the
 * first summary, then each one it chimed for. Ids are UUIDv7, so they compare as text.
 */
export type ChimeState = { started: boolean; baseline: string | null };

export const initialChime: ChimeState = { started: false, baseline: null };

/**
 * Whether a summary brings a new unread activation. The first summary only sets the
 * baseline, so the backlog never chimes; several new ones between checks chime once.
 */
export function nextChime(
  state: ChimeState,
  summary: Pick<AlertNotificationSummary, "newest_unread_activation_id">,
): { state: ChimeState; chime: string | null } {
  const newest = summary.newest_unread_activation_id ?? null;
  if (!state.started) return { state: { started: true, baseline: newest }, chime: null };
  if (newest && (!state.baseline || newest > state.baseline)) return { state: { started: true, baseline: newest }, chime: newest };
  return { state, chime: null };
}
