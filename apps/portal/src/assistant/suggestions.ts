/*
 * What the assistant offers on each page. Ask opens on these wherever the page has no
 * assistant of its own, so the profile and automation assistants are reachable from
 * anywhere and the first choices fit the page the person is on. The model is pure, so
 * it is tested without the panel; HelpPanel draws it and carries out the actions.
 */

export type SuggestionAction =
  /** The page's own assistant, e.g. the automation editor's. */
  | { kind: "context" }
  /** The profile assistant: a new profile, or improving the one being viewed. */
  | { kind: "profile"; profile?: string }
  /** The automation assistant in a new automation, with an example request to edit. */
  | { kind: "automation"; text: string }
  /** Usage help from the guides. */
  | { kind: "help" }
  /** The device onboarding assistant (spec 020); `fresh` starts a new conversation. */
  | { kind: "onboarding"; fresh?: boolean }

export type Suggestion = {
  id: string
  title: string
  description: string
  action: SuggestionAction
}

export type SuggestionInput = {
  /** The portal path, e.g. /organizations/{org}/devices/{device}/overview. */
  pathname: string
  /** The title of the page's own assistant, when it has one. */
  slot?: string | null
  /** The device profile being viewed. */
  profile?: string
  /** On a device's page, the profile it uses. */
  deviceProfile?: { uuid: string; name: string } | null
  can: { profiles: boolean; adapters: boolean }
}

const createProfile: Suggestion = {
  id: "profile",
  title: "Create a device profile",
  description: "Describe the device or share its datasheet. I prepare each section for your review.",
  action: { kind: "profile" },
}
const buildAutomation: Suggestion = {
  id: "automation",
  title: "Build an automation",
  description: "Say what should happen and when. I draft the workflow for you to test and activate.",
  action: { kind: "automation", text: "" },
}
const onboardDevice: Suggestion = {
  id: "onboarding",
  title: "Onboard a device with the assistant",
  description: "Describe the device; it works out how to connect it, from Sparkplug B to a vendor's webhooks or API.",
  action: { kind: "onboarding", fresh: true },
}
const askHelp: Suggestion = {
  id: "help",
  title: "Ask how to use the portal",
  description: "Answers come from the approved guides and link to the steps.",
  action: { kind: "help" },
}
const thresholdAlert: Suggestion = {
  id: "automation.threshold",
  title: "Alert me when a reading crosses a limit",
  description: "For example, email the team when a temperature stays high, and again when it recovers.",
  action: {
    kind: "automation",
    text: "Email me when the temperature on <device> stays above 60 °C for 5 minutes, and again when it drops below 55 °C.",
  },
}
const geofenceAlert: Suggestion = {
  id: "automation.geofence",
  title: "Alert me when a device leaves an area",
  description: "Email the team when a tracked device crosses a geofence.",
  action: { kind: "automation", text: "Email me when <device> leaves the <geofence> geofence." },
}

/** Suggestions for this page first, then the rest of what the assistant can do anywhere. */
export function assistantSuggestions({ pathname, slot, profile, deviceProfile, can }: SuggestionInput): {
  here: Suggestion[]
  more: Suggestion[]
} {
  const [, root, , section, resource] = pathname.split("/")
  const here: Suggestion[] = []
  if (slot)
    here.push({
      id: "context",
      title: `Continue with ${slot}`,
      description: "This page's assistant, working on what you have open.",
      action: { kind: "context" },
    })
  if (root === "organizations")
    switch (section) {
      case "device-profiles":
        if (profile && can.profiles)
          here.push({
            id: "profile.improve",
            title: "Improve this profile",
            description: "Add parameters, units, conversions or calculations, each reviewed before saving.",
            action: { kind: "profile", profile },
          })
        else if (can.profiles) here.push(createProfile)
        break
      case "devices":
      case "discovery":
        if (can.adapters && resource === "onboard") here.push(onboardDevice)
        if (can.profiles && resource && deviceProfile)
          here.push({
            id: "profile.device",
            title: `Improve the ${deviceProfile.name} profile`,
            description: "Add readings, units or calculations for every device that uses it, each reviewed before saving.",
            action: { kind: "profile", profile: deviceProfile.uuid },
          })
        else if (can.profiles)
          here.push({ ...createProfile, title: "Describe a new kind of device", id: "profile.device" })
        here.push(thresholdAlert)
        break
      case "alerts":
        here.push({ ...thresholdAlert, title: "Set up a new alert" })
        break
      case "settings":
        if (resource === "notifications") here.push({ ...thresholdAlert, title: "Set up a new alert" })
        break
      case "dashboards":
      case "home":
        here.push(thresholdAlert)
        break
      case "automation":
        if (!slot) here.push(buildAutomation, thresholdAlert)
        break
      case "geofences":
      case "sites":
        here.push(geofenceAlert)
        break
      case "device-adapters":
        if (resource && resource !== "new" && can.adapters)
          here.push({
            id: "adapter",
            title: "Continue onboarding this adapter",
            description: "It reads the captured samples, drafts the decoder and settings, and says what is left.",
            action: { kind: "onboarding" },
          })
        else if (can.adapters) here.push(onboardDevice)
        break
    }
  // The universal tasks follow, minus any the page already offers in another form.
  const offered = new Set(here.map((item) => item.action.kind))
  const more = [
    ...(can.profiles && !offered.has("profile") ? [createProfile] : []),
    ...(!offered.has("automation") ? [buildAutomation] : []),
    askHelp,
  ].filter((item) => !here.includes(item))
  return { here, more }
}
