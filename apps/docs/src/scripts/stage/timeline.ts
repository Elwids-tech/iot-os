// The landing stage's script: one device from firmware to an alert, in four beats. The
// transcript is rendered from these lines at build time and revealed at `at`
// milliseconds; the scene reads the same beat times. Every step is something the
// platform does today (the firmware, discovery, dashboard and automation guides),
// compressed in time; the page labels it an illustration.

export type LineKind = 'user' | 'assistant' | 'card' | 'command' | 'event'
export type LineTone = 'neutral' | 'success' | 'warning'

export interface Line {
  at: number
  kind: LineKind
  text: string
  /** A card's second line and its action, drawn as a label (not a control). */
  meta?: string
  action?: string
  tone?: LineTone
}

export interface Beat {
  id: 'firmware' | 'connect' | 'watch' | 'alert'
  label: string
  start: number
}

export const beats: Beat[] = [
  { id: 'firmware', label: 'Firmware', start: 0 },
  { id: 'connect', label: 'Connect', start: 5600 },
  { id: 'watch', label: 'Watch', start: 9400 },
  { id: 'alert', label: 'Alert', start: 13400 },
]

/** When the scene's moments happen, in milliseconds from the start. */
export const moments = {
  starterDrop: 2600,
  flashStart: 3600,
  flashEnd: 4700,
  connected: 5800,
  birth: 7000,
  online: 8200,
  panelAdded: 9700,
  activated: 17300,
  rise: 17600,
  alert: 19600,
} as const

/** The loop restarts after this; with reduced motion the stage shows this moment. */
export const duration = 24000

export const lines: Line[] = [
  { at: 400, kind: 'user', text: 'Firmware for the Cold room sensor profile, on an ESP32.' },
  {
    at: 1500,
    kind: 'assistant',
    text: 'Here’s a starter for ESP32 (ESP-IDF): the embedded SDK and this profile’s metrics, with no credentials inside. Add the device’s settings to config/, then build and flash.',
  },
  { at: moments.starterDrop, kind: 'card', text: 'Firmware starter', meta: 'Cold room sensor · ESP32 (ESP-IDF)', action: 'Download starter' },
  { at: moments.flashStart, kind: 'command', text: 'idf.py build flash' },
  { at: moments.flashEnd, kind: 'event', text: 'Flashed cold-room-1' },

  { at: moments.connected, kind: 'event', text: 'cold-room-1 connected · Sparkplug B over MQTT with TLS', tone: 'success' },
  { at: moments.birth, kind: 'event', text: 'Announced temperature (°C), door and battery (V)' },
  { at: moments.online, kind: 'event', text: 'Online · readings arriving', tone: 'success' },

  { at: moments.panelAdded, kind: 'event', text: 'You added a Temperature panel to the Cold room dashboard' },
  { at: 11000, kind: 'event', text: 'Temperature 4.2 °C · fresh' },
  { at: 12200, kind: 'event', text: 'Door closed · battery 3.6 V' },

  { at: 13700, kind: 'user', text: 'Alert me when the cold room is above 8 °C for 5 minutes.' },
  {
    at: 14900,
    kind: 'assistant',
    text: 'Here’s a draft automation: temperature above 8 °C for 5 minutes raises an alert, and its recipients get an email. Review it, simulate it, then activate it.',
  },
  { at: 16000, kind: 'card', text: 'Automation draft', meta: 'Temperature > 8 °C for 5 min → alert and email', action: 'Use this draft' },
  { at: moments.activated, kind: 'event', text: 'You simulated it and activated Cold room too warm', tone: 'success' },
  { at: moments.alert, kind: 'event', text: 'Alert · temperature 8.6 °C for 5 min · email sent', tone: 'warning' },
]

/** The beat playing at `time`. */
export function beatAt(time: number): Beat {
  return beats.reduce((current, beat) => (time >= beat.start ? beat : current), beats[0])
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

/** The temperature the cold room reports at `time`: steady around 4 °C, then rising past 8. */
export function temperature(time: number): number {
  const rise = easeInOutCubic(clamp01((time - moments.rise) / (moments.alert - moments.rise)))
  const noise = 0.22 * Math.sin(time / 900) + 0.1 * Math.sin(time / 370)
  return 4.2 + noise * (1 - 0.6 * rise) + 4.4 * rise
}
