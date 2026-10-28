import { describe, expect, it } from "vitest"
import { assistantSuggestions } from "./suggestions"

const org = "/organizations/0f8b6c1e-0000-4000-8000-000000000001"
const all = { profiles: true, adapters: true }
const ids = (input: Parameters<typeof assistantSuggestions>[0]) => {
  const { here, more } = assistantSuggestions(input)
  return { here: here.map((item) => item.id), more: more.map((item) => item.id) }
}

describe("assistant suggestions", () => {
  it("offer the profile and automation assistants from any page, then usage help", () => {
    expect(ids({ pathname: `${org}/telemetry`, can: all })).toEqual({
      here: [],
      more: ["profile", "automation", "help"],
    })
  })

  it("put the page's own assistant first and still offer a new automation", () => {
    expect(ids({ pathname: `${org}/automation/abc`, slot: "Pump alarm", can: all })).toEqual({
      here: ["context"],
      more: ["profile", "automation", "help"],
    })
    expect(assistantSuggestions({ pathname: `${org}/automation/abc`, slot: "Pump alarm", can: all }).here[0].title).toBe(
      "Continue with Pump alarm",
    )
  })

  it("improve the viewed profile, or create one from the profile list", () => {
    const viewed = assistantSuggestions({ pathname: `${org}/device-profiles/p-1/parameters`, profile: "p-1", can: all })
    expect(viewed.here.map((item) => item.action)).toEqual([{ kind: "profile", profile: "p-1" }])
    expect(viewed.more.map((item) => item.id)).toEqual(["automation", "help"])
    expect(ids({ pathname: `${org}/device-profiles`, can: all }).here).toEqual(["profile"])
  })

  it("suggest device work on device pages and an example alert to edit", () => {
    const devices = assistantSuggestions({ pathname: `${org}/devices/d-1/overview`, can: all })
    expect(devices.here.map((item) => item.id)).toEqual(["profile.device", "automation.threshold"])
    expect(devices.here[1].action).toMatchObject({ kind: "automation", text: expect.stringContaining("above 60 °C") })
    expect(devices.more.map((item) => item.id)).toEqual(["help"])
  })

  it("on a device's page, improve the profile it uses", () => {
    const device = assistantSuggestions({
      pathname: `${org}/devices/d-1/overview`,
      deviceProfile: { uuid: "p-9", name: "Fire-watch box" },
      can: all,
    })
    expect(device.here[0]).toMatchObject({ title: "Improve the Fire-watch box profile", action: { kind: "profile", profile: "p-9" } })
    expect(ids({ pathname: `${org}/devices`, deviceProfile: { uuid: "p-9", name: "Box" }, can: all }).here[0]).toBe("profile.device")
    expect(assistantSuggestions({ pathname: `${org}/devices`, can: all }).here[0].title).toBe("Describe a new kind of device")
  })

  it("leave out profile work for people who cannot edit profiles", () => {
    const none = { profiles: false, adapters: false }
    expect(ids({ pathname: `${org}/devices`, can: none })).toEqual({ here: ["automation.threshold"], more: ["help"] })
    expect(ids({ pathname: `${org}/device-profiles/p-1`, profile: "p-1", can: none }).here).toEqual([])
  })

  it("continue a saved adapter's onboarding conversation, and start a new one for new devices", () => {
    expect(ids({ pathname: `${org}/device-adapters/a-1`, can: all }).here).toEqual(["adapter"])
    expect(assistantSuggestions({ pathname: `${org}/device-adapters/a-1`, can: all }).here[0].action).toEqual({ kind: "onboarding" })
    expect(ids({ pathname: `${org}/device-adapters/new`, can: all }).here).toEqual(["onboarding"])
    expect(ids({ pathname: `${org}/device-adapters`, can: all }).here).toEqual(["onboarding"])
    expect(assistantSuggestions({ pathname: `${org}/device-adapters`, can: all }).here[0].action).toEqual({ kind: "onboarding", fresh: true })
    expect(ids({ pathname: `${org}/devices/onboard`, can: all }).here[0]).toBe("onboarding")
    expect(ids({ pathname: `${org}/device-adapters/a-1`, can: { profiles: true, adapters: false } }).here).toEqual([])
  })

  it("match alerts, locations and dashboards to the automations people build there", () => {
    expect(ids({ pathname: `${org}/alerts/x`, can: all }).here).toEqual(["automation.threshold"])
    expect(assistantSuggestions({ pathname: `${org}/alerts`, can: all }).here[0].title).toBe("Set up a new alert")
    expect(ids({ pathname: `${org}/geofences/g-1`, can: all }).here).toEqual(["automation.geofence"])
    expect(ids({ pathname: `${org}/sites`, can: all }).here).toEqual(["automation.geofence"])
    expect(ids({ pathname: `${org}/dashboards/d-1`, can: all }).here).toEqual(["automation.threshold"])
    expect(ids({ pathname: `${org}/settings/notifications`, can: all }).here).toEqual(["automation.threshold"])
    expect(ids({ pathname: `${org}/settings/members`, can: all }).here).toEqual([])
  })
})
