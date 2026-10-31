import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AlertNotificationSummary } from "@iot-os/api-client";
import { api } from "../../lib/api";
import { audioReady, claim, listenForUnlock, onSoundChange, play, setSoundEnabled, soundEnabled } from "./chime";
import { alertBellKeys, initialChime, nextChime, notificationNames, pollInterval } from "./model";

type AlertBellContext = {
  org: string;
  manage: boolean;
  /** Undefined until the first check, and while checks fail. */
  summary: AlertNotificationSummary | undefined;
  sound: boolean;
  setSound: (on: boolean) => void;
};

const Context = createContext<AlertBellContext | null>(null);

/** The bell's state for the page header, or null where the person has no bell. */
export const useAlertBell = () => useContext(Context);

/**
 * One per organization and tab, mounted above the pages so polling and the chime's
 * baseline survive navigation (each page renders its own header). It checks the
 * summary every 15 s while the tab is visible and every 60 s while hidden, and on a
 * new unread activation chimes once across the browser's tabs and tells screen readers.
 */
export function AlertBellProvider({
  org,
  userId,
  enabled,
  manage,
  children,
}: {
  org: string | undefined;
  userId: number;
  enabled: boolean;
  manage: boolean;
  children: ReactNode;
}) {
  const cache = useQueryClient();
  const active = Boolean(org) && enabled;
  const summary = useQuery({
    queryKey: alertBellKeys.summary(org ?? ""),
    queryFn: ({ signal }) => api.alertNotificationSummary(org!, signal),
    enabled: active,
    refetchInterval: () => pollInterval(document.visibilityState),
    refetchIntervalInBackground: true,
    staleTime: 10_000,
    retry: 1,
  });
  const [sound, setSound] = useState(soundEnabled);
  const [announcement, setAnnouncement] = useState({ text: "", key: 0 });
  const chime = useRef(initialChime);

  useEffect(() => (active ? listenForUnlock() : undefined), [active]);
  useEffect(() => onSoundChange(setSound), []);

  useEffect(() => {
    if (!summary.data || !org) return;
    const next = nextChime(chime.current, summary.data);
    chime.current = next.state;
    const id = next.chime;
    if (!id) return;
    void cache.invalidateQueries({ queryKey: alertBellKeys.list(org) });
    if (soundEnabled() && audioReady()) void claim(userId, id).then((won) => won && play());
    // Screen readers hear the automation whether or not sound is on.
    void api
      .alertNotifications(org, 1)
      .then((page) => page.data.find((item) => item.id === id))
      .catch(() => undefined)
      .then((item) => {
        const names = item && notificationNames(item);
        setAnnouncement((current) => ({
          text: names ? `New alert: ${names.title}${names.device ? `, ${names.device}` : ""}` : "New alert",
          key: current.key + 1,
        }));
      });
  }, [summary.dataUpdatedAt]);

  const value: AlertBellContext | null = active
    ? {
        org: org!,
        manage,
        summary: summary.isError ? undefined : summary.data,
        sound,
        setSound: (on) => {
          setSoundEnabled(on);
          setSound(on);
        },
      }
    : null;

  return (
    <Context.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        <span key={announcement.key}>{announcement.text}</span>
      </div>
    </Context.Provider>
  );
}
