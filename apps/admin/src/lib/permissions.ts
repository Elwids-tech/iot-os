// Plain labels for tenant permission keys. Unknown keys fall back to the raw key.
const groupLabels: Record<string, string> = {
  Organization: "Organization",
  User: "Users",
  Role: "Roles",
  DeviceProfile: "Device profiles",
  Device: "Devices",
}

const permissionLabels: Record<string, string> = {
  "Organization.view-any": "List organizations",
  "Organization.view": "View organization",
  "Organization.create": "Create organizations",
  "Organization.update": "Edit organization",
  "Organization.delete": "Delete organization",
  "Organization.restore": "Restore organization",
  "Organization.force-delete": "Permanently delete organization",
  "User.view-any": "List users",
  "User.view": "View user",
  "User.create": "Create users",
  "User.update": "Edit users and their roles",
  "User.delete": "Remove users",
  "User.restore": "Restore users",
  "User.force-delete": "Permanently delete users",
  "Role.view-any": "List roles",
  "Role.view": "View role",
  "Role.create": "Create roles",
  "Role.update": "Edit roles",
  "Role.delete": "Delete roles",
  "Role.restore": "Restore roles",
  "Role.force-delete": "Permanently delete roles",
  "DeviceProfile.view-any": "List device profiles",
  "DeviceProfile.view": "View device profile",
  "DeviceProfile.create": "Create device profiles",
  "DeviceProfile.update": "Edit profile drafts",
  "DeviceProfile.delete-draft": "Delete unpublished drafts",
  "DeviceProfile.validate": "Validate drafts",
  "DeviceProfile.publish": "Publish revisions",
  "TransportBinding.manage": "Manage transport bindings",
  "Device.view": "View devices",
  "Device.manage": "Manage devices",
  "Device.manage-connections": "Manage gateways and connections",
  "Device.activate": "Activate and deactivate devices",
  "Device.command": "Send device commands",
}

export const permissionGroupLabel = (group: string) => groupLabels[group] ?? group
export const permissionLabel = (name: string) => permissionLabels[name] ?? name
