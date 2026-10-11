/** Fixture fleet for stories: realistic names, codes and states, with a fixed clock. */
export const now = Date.parse("2026-10-10T12:00:00Z")
export const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

export type FixtureDevice = {
  uuid: string
  name: string
  code: string
  lifecycle: "registered" | "active" | "deactivated" | "archived"
  presence: "online" | "offline" | "unseen"
  lastSeen: string | null
  expected: number | null
  profile: string | null
  gateway: string | null
  site: string | null
  readings: number
}

const profiles = ["Water meter (simulator)", "GPS Tracker (simulator)", "RGB Light (simulator)", "Environmental sensor (vendor JSON)", "Three-phase Energy Meter"]
const gateways = ["Workshop gateway", "GPS simulator gateway", "RGB simulator gateway", "Vendor environmental sensor", "Boiler room gateway"]
const sites = ["Colombo plant", "Kandy depot", "Galle warehouse", null]
const names = ["Boiler room sensor", "Workshop water meter", "GPS Demo Tracker", "RGB LED · Controls demo", "Bench environmental sensor", "Compressor energy meter", "Cold store probe", "Loading bay tracker", "Roof weather station", "Pump house meter"]

export const fleet: FixtureDevice[] = Array.from({ length: 42 }, (_, index) => {
  const kind = index % profiles.length
  const lifecycle = (["active", "active", "active", "active", "registered", "deactivated", "archived"] as const)[index % 7]
  const presence = lifecycle === "active" ? (index % 5 === 3 ? "offline" : "online") : lifecycle === "registered" ? "unseen" : "offline"
  const quiet = index % 6 === 2
  return {
    uuid: `device-${index}`,
    name: `${names[index % names.length]} ${Math.floor(index / names.length) + 1}`,
    code: `${names[index % names.length].toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
    lifecycle,
    presence,
    lastSeen: lifecycle === "registered" ? null : ago(quiet ? 6 * 86400 : (index * 37) % 900 + 1),
    expected: lifecycle === "active" && presence === "online" ? 900 : null,
    profile: lifecycle === "registered" ? null : profiles[kind],
    gateway: lifecycle === "registered" ? null : gateways[kind],
    site: sites[index % sites.length],
    readings: lifecycle === "active" ? 1440 - ((index * 53) % 400) : 0,
  }
})
