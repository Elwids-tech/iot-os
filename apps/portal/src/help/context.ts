/** Resolve only UI page identifiers; resource IDs and form contents never enter Help context. */
export function helpContextForPath(pathname: string): string {
  const [, root, , section, resource, tab] = pathname.split("/");
  if (root !== "organizations") return "getting-started";
  switch (section) {
    case "devices":
      return resource
        ? `devices.${({ data: "measurements", control: "controls" } as Record<string, string>)[tab] ?? (["overview", "measurements", "history", "configuration", "controls", "commands"].includes(tab) ? tab : "overview")}`
        : "devices";
    case "device-profiles":
      return resource
        ? `device-profiles.${["overview", "parameters", "calculations", "alarms", "review"].includes(tab) ? tab : "overview"}`
        : "device-profiles";
    case "automation":
      return resource ? "automation.editor" : "automation";
    case "geofences":
      return resource ? "geofences.editor" : "geofences";
    case "integrations":
      return resource ? "integrations.application" : "integrations";
    case "alerts":
      return resource === "notifications"
        ? tab
          ? "alerts.notifications.workflow"
          : "alerts.notifications"
        : resource === "events" || resource === "preferences"
          ? `alerts.${resource}`
          : resource
            ? "alerts.detail"
            : "alerts";
    case "settings":
      return resource === "members"
        ? "members"
        : resource === "roles"
          ? tab
            ? "roles.editor"
            : "roles"
          : resource === "notifications"
            ? tab
              ? "alerts.notifications.workflow"
              : "alerts.notifications"
            : resource === "email"
              ? "alerts.preferences"
              : "getting-started";
    case "connections":
      return "gateways";
    case "dashboards":
      return resource ? "dashboards.workspace" : "dashboards";
    case "roles":
      return resource ? "roles.editor" : "roles";
    case "discovery":
    case "gateways":
    case "telemetry":
    case "members":
      return section;
    default:
      return "getting-started";
  }
}
