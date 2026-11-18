import type { TwoStepRequirement } from "@iot-os/api-client"

/** Who requires a person to use two-step sign-in, in one sentence (spec 034, FR-020, FR-021). */
export function requirementText(requiredBy: TwoStepRequirement[]): string | null {
  const platform = requiredBy.includes("platform")
  const names = requiredBy.flatMap((reason) => (reason === "platform" ? [] : [reason.name]))
  const require = (what: string) => `${list(names)} ${names.length === 1 ? "requires" : "require"} ${what} for every member`
  if (platform && names.length > 0) return `Two-step sign-in is required for platform staff, and ${require("it")}.`
  if (platform) return "Two-step sign-in is required for platform staff."
  if (names.length > 0) return `${require("two-step sign-in")}.`
  return null
}

function list(names: string[]): string {
  if (names.length < 3) return names.join(" and ")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}
