// The landing stage's script: one device from firmware to an alarm, in four beats. The
// scene reads the moments; the ribbon under it shows the caption for the moment. Every
// step is something the platform does today (the firmware, discovery, dashboard and
// automation guides), compressed in time; the page labels it an illustration.

export type BeatId = 'firmware' | 'connect' | 'watch' | 'automate'

export interface Beat {
  id: BeatId
  label: string
  start: number
}

export interface Caption {
  at: number
  text: string
}

/** When the scene's moments happen, in milliseconds from the start. */
export const moments = {
  starterDrop: 1900,
  flashStart: 3000,
  flashEnd: 4200,
  connected: 5200,
  birth: 6300,
  online: 7300,
  panelAdded: 8600,
  activated: 13000,
  rise: 13700,
  alarm: 17400,
  phoneIn: 18300,
  mailIn: 19500,
} as const

/** The loop restarts after this. */
export const duration = 23500

export const beats: Beat[] = [
  { id: 'firmware', label: 'Firmware', start: 0 },
  { id: 'connect', label: 'Connect', start: moments.connected },
  { id: 'watch', label: 'Watch', start: moments.panelAdded },
  { id: 'automate', label: 'Automate', start: moments.activated },
]

export const captions: Caption[] = [
  { at: 0, text: 'A firmware starter for your board: the embedded SDK and the profile’s metrics, with no credentials inside.' },
  { at: moments.flashStart, text: 'Build and flash. The SDK handles the connection and the messages; your code reads the sensor.' },
  { at: moments.connected, text: 'The device connects over Sparkplug B with TLS and announces what it reports: temperature, door and battery.' },
  { at: moments.panelAdded, text: 'Readings land on a dashboard, each with its unit and how fresh it is.' },
  { at: moments.activated, text: 'An automation watches the cold room: above 8 °C for 5 minutes.' },
  { at: moments.alarm, text: 'Too warm. The alarm comes on, and the team gets a text and an email.' },
]

/** The beat playing at `time`. */
export function beatAt(time: number): Beat {
  return beats.reduce((current, beat) => (time >= beat.start ? beat : current), beats[0])
}

/** The caption for `time`. */
export function captionAt(time: number): Caption {
  return captions.reduce((current, caption) => (time >= caption.at ? caption : current), captions[0])
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

/** The temperature the cold room reports at `time`: steady around 4 °C, then rising past 8. */
export function temperature(time: number): number {
  const rise = easeInOutCubic(clamp01((time - moments.rise) / (moments.alarm - moments.rise)))
  const noise = 0.22 * Math.sin(time / 900) + 0.1 * Math.sin(time / 370)
  return 4.2 + noise * (1 - 0.6 * rise) + 4.4 * rise
}
