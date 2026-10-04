package dag

import "sort"

// Expand selected settings into independently authorized, idempotent commands.
// Keep legacy single-setting configurations unchanged.
func commandConfigs(config map[string]any) []map[string]any {
	settings, multi := config["settings"].(map[string]any)
	if !multi {
		return []map[string]any{config}
	}
	roles := make([]string, 0, len(settings))
	for role := range settings {
		roles = append(roles, role)
	}
	sort.Strings(roles)
	commands := make([]map[string]any, 0, len(roles))
	for _, role := range roles {
		commands = append(commands, map[string]any{"binding": role, "value": settings[role], "cooldown_seconds": config["cooldown_seconds"], "ttl_seconds": config["ttl_seconds"]})
	}
	return commands
}
