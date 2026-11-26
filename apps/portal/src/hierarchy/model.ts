import type { EntityMoveImpact, EntitySummary, EntityType } from "@iot-os/api-client"

/** Types an entity may have under `parent` (top-level types when null). */
export function allowedTypes(types: EntityType[], parent: { type: { key: string } } | null) {
  return types.filter((type) => (parent ? type.parent_type_keys.includes(parent.type.key) : type.top_level))
}

/** "Line 2 · Plant/Packaging" for a picker: the name, then where it sits. */
export function entityLabel(entity: Pick<EntitySummary, "name" | "path">) {
  const parent = entity.path.split("/").slice(0, -1).join("/")
  return parent ? `${entity.name} · ${parent}` : entity.name
}

/** "Names follow Feeder<number>, e.g. Feeder12: Feeder and its number." */
export function namingHint(type: Pick<EntityType, "naming"> | undefined) {
  if (!type?.naming) return undefined
  const { template, example, description } = type.naming
  return `Names follow ${template}${example ? `, e.g. ${example}` : ""}${description ? `: ${description}` : ""}.`
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** What a move changes, in the words the move dialog shows before anything moves. */
export function impactLines(impact: EntityMoveImpact, name: string): string[] {
  const lines = [
    impact.entities > 1
      ? `${name} and ${count(impact.entities - 1, "entity", "entities")} below it get new paths.`
      : `${name} gets a new path.`,
    impact.devices ? `${count(impact.devices, "device moves", "devices move")} with it.` : "No devices are placed in it.",
  ]
  if (impact.devices_changing_site)
    lines.push(`${count(impact.devices_changing_site, "device changes", "devices change")} site.`)
  if (impact.devices_changing_timezone)
    lines.push(
      `${count(impact.devices_changing_timezone, "device changes", "devices change")} time zone: days and shifts start at a different hour from now on.`,
    )
  for (const application of impact.applications) {
    if (application.gains) lines.push(`${application.name} gains ${count(application.gains, "device", "devices")}.`)
    if (application.loses) lines.push(`${application.name} loses ${count(application.loses, "device", "devices")}.`)
  }
  return lines
}

const endReasons: Record<string, string> = {
  moved: "moved elsewhere",
  unplaced: "taken out of the hierarchy",
  device_archived: "the device was archived",
  moved_out: "moved to another organization",
  entity_archived: "the place was archived",
  replaced: "joined another group of that type",
  left: "left",
  archived: "archived",
}

/** Why a placement or membership ended, as a clause: "moved elsewhere". */
export function endReasonText(reason: string | null | undefined) {
  return reason ? (endReasons[reason] ?? reason.replaceAll("_", " ")) : undefined
}

