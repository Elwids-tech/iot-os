import { expect, test as base, type Page, type Route } from "@playwright/test"

const organizations = [
  {
    uuid: "11111111-1111-4111-8111-111111111111",
    name: "Acme Manufacturing",
    slug: "acme-manufacturing",
    users_count: 3,
    devices_count: 6,
  },
  {
    uuid: "22222222-2222-4222-8222-222222222222",
    name: "Northstar Utilities",
    slug: "northstar-utilities",
    users_count: 3,
    devices_count: 0,
  },
]

const directoryUsers = [
  {
    id: 1,
    name: "Platform Super Admin",
    email: "super-admin@example.test",
    is_super_admin: true,
    platform_roles: [],
    organizations: [],
  },
  {
    id: 2,
    name: "Platform Administrator",
    email: "platform-admin@example.test",
    is_super_admin: false,
    platform_roles: [{ key: "platform-administrator", display_name: "Platform Administrator" }],
    organizations: [],
  },
  {
    id: 3,
    name: "Shared Operations Admin",
    email: "shared.operator@example.test",
    is_super_admin: false,
    platform_roles: [],
    organizations,
  },
  {
    id: 4,
    name: "Acme Member",
    email: "acme.member@example.test",
    is_super_admin: false,
    platform_roles: [],
    organizations: [organizations[0]],
  },
  {
    id: 5,
    name: "Northstar Member",
    email: "northstar.member@example.test",
    is_super_admin: false,
    platform_roles: [],
    organizations: [organizations[1]],
  },
]

const directoryRoles = [
  {
    id: 1,
    key: "organization-admin",
    display_name: "Organization Admin",
    is_default: true,
    permissions_count: 21,
    organization: organizations[0],
  },
  {
    id: 2,
    key: "moderator",
    display_name: "Moderator",
    is_default: true,
    permissions_count: 3,
    organization: organizations[0],
  },
  {
    id: 3,
    key: "member",
    display_name: "Member",
    is_default: true,
    permissions_count: 1,
    organization: organizations[1],
  },
]

const invitationRoles = [
  { id: 1, display_name: "Organization Admin" },
  { id: 2, display_name: "Moderator" },
  { id: 3, display_name: "Member" },
]

const tenantPermissions = [
  { name: "Organization.view", group: "Organization" },
  { name: "Organization.update", group: "Organization" },
  { name: "Role.view-any", group: "Role" },
  { name: "User.view-any", group: "User" },
  { name: "User.update", group: "User" },
]

const superAdmin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_assistant: true },
  organizations,
}

const platformAdmin = {
  id: 2,
  name: "Platform Administrator",
  email: "platform-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: false,
  capabilities: { platform_administration: true, manage_assistant: false },
  organizations: [],
}

const tenantUser = {
  id: 3,
  name: "Shared Operations Admin",
  email: "shared.operator@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: false,
  capabilities: { platform_administration: false, manage_assistant: false },
  organizations,
}

type SessionUser = typeof superAdmin

function paginated<T>(items: T[], url: URL) {
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10), 1)
  const perPage = Math.max(Number.parseInt(url.searchParams.get("per_page") ?? "25", 10), 1)
  const start = (page - 1) * perPage
  const data = items.slice(start, start + perPage)

  return {
    data,
    meta: {
      current_page: page,
      from: data.length > 0 ? start + 1 : null,
      last_page: Math.max(Math.ceil(items.length / perPage), 1),
      per_page: perPage,
      to: data.length > 0 ? start + data.length : null,
      total: items.length,
    },
  }
}

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, json })
}

const customRoles = [
  {
    id: 4,
    key: "custom-01k8field",
    display_name: "Field Technician",
    is_default: false,
    permissions_count: 1,
    organization: organizations[0],
  },
  {
    id: 5,
    key: "custom-01k8shift",
    display_name: "Shift Lead",
    is_default: false,
    permissions_count: 1,
    organization: organizations[0],
  },
]

async function mockApi(
  page: Page,
  options: {
    initiallyAuthenticated?: boolean
    roleDetailStatus?: number
    user?: SessionUser
    /** Adds two Acme custom roles: Field Technician (unused) and Shift Lead (held by Acme Member). */
    customRoles?: boolean
    /** Organizations whose delete gets a 409, as if a device appeared after the check. */
    deleteConflicts?: string[]
  } = {},
) {
  let signedIn = options.initiallyAuthenticated ?? true
  const user = options.user ?? superAdmin
  const orgs = organizations.map((organization) => ({ ...organization }))
  const roles = [...directoryRoles, ...(options.customRoles ? customRoles : [])].map((role) => ({ ...role }))
  const users = directoryUsers.map((item) => ({ ...item, organizations: [...item.organizations] }))
  const memberRoles = new Map<string, number[]>([
    [`${organizations[0].uuid}:3`, [1]],
    [`${organizations[0].uuid}:4`, [2]],
    [`${organizations[1].uuid}:3`, [3]],
    [`${organizations[1].uuid}:5`, [3]],
    ...(options.customRoles ? [[`${organizations[0].uuid}:4`, [2, 5]] as [string, number[]]] : []),
  ])
  const unprocessable = (route: Route, field: string, message: string) =>
    fulfillJson(route, { message, errors: { [field]: [message] } }, 422)
  const rolePermissions = new Map<number, Set<string>>([
    [1, new Set(tenantPermissions.map((permission) => permission.name))],
    [2, new Set(["Organization.view", "User.view-any"])],
    [3, new Set(["Organization.view"])],
    [4, new Set(["Organization.view"])],
    [5, new Set(["Organization.view"])],
  ])
  const ceiling = { restricted: false, names: tenantPermissions.map((permission) => permission.name) }
  const invitations = [
    {
      uuid: "invite-1",
      email: "pending@example.test",
      role_ids: [3],
      roles: [invitationRoles[2]],
      grants_super_admin: false,
      organization: organizations[1] as (typeof organizations)[number] | null,
      expires_at: "2026-09-01T12:00:00.000000Z",
      accepted_at: null,
      revoked_at: null,
      status: "pending",
    },
  ]

  function roleDetail(id: number) {
    const role = roles.find((item) => item.id === id)

    if (!role) return null

    const permissionsEditable = role.key !== "organization-admin"
    const selected = rolePermissions.get(id) ?? new Set<string>()

    return {
      ...role,
      permissions_editable: permissionsEditable,
      permission_update_message: permissionsEditable
        ? null
        : "The Organization Admin permission baseline cannot be changed. Create a custom role for a different permission bundle.",
      permissions: tenantPermissions.map((permission) => ({
        ...permission,
        assigned: selected.has(permission.name),
      })),
    }
  }

  await page.route("**/sanctum/csrf-cookie", async (route) => {
    await route.fulfill({ status: 204 })
  })

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === "GET" && url.pathname === "/api/v1/me") {
      if (!signedIn) {
        await fulfillJson(route, { message: "Unauthenticated." }, 401)
        return
      }

      await fulfillJson(route, { data: user })
      return
    }

    if (request.method() === "POST" && url.pathname === "/api/v1/auth/login") {
      signedIn = true
      await fulfillJson(route, { data: user })
      return
    }

    if (request.method() === "POST" && url.pathname === "/api/v1/auth/logout") {
      signedIn = false
      await route.fulfill({ status: 204 })
      return
    }

    if (request.method() === "GET" && url.pathname === "/api/v1/admin/organizations") {
      const search = url.searchParams.get("search")?.toLocaleLowerCase() ?? ""
      const results = orgs.filter(
        (organization) =>
          organization.name.toLocaleLowerCase().includes(search) ||
          organization.slug.toLocaleLowerCase().includes(search),
      )

      await fulfillJson(route, paginated(results, url))
      return
    }

    if (request.method() === "POST" && url.pathname === "/api/v1/admin/organizations") {
      const payload = request.postDataJSON() as { name: string; slug: string }

      if (orgs.some((item) => item.slug === payload.slug)) {
        await unprocessable(route, "slug", "The slug has already been taken.")
        return
      }

      const organization = {
        uuid: "33333333-3333-4333-8333-333333333333",
        name: payload.name,
        slug: payload.slug,
        users_count: 0,
        devices_count: 0,
      }
      orgs.push(organization)
      orgs.sort((left, right) => left.name.localeCompare(right.name))
      await fulfillJson(route, { data: organization }, 201)
      return
    }

    const organizationMatch = url.pathname.match(/^\/api\/v1\/admin\/organizations\/([^/]+)$/)

    if (request.method() === "PATCH" && organizationMatch) {
      const payload = request.postDataJSON() as { name: string; slug: string }
      const organization = orgs.find((item) => item.uuid === organizationMatch[1])

      if (!organization) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }

      if (orgs.some((item) => item !== organization && item.slug === payload.slug)) {
        await unprocessable(route, "slug", "The slug has already been taken.")
        return
      }

      Object.assign(organization, payload)
      await fulfillJson(route, { data: organization })
      return
    }

    const deletionMatch = url.pathname.match(/^\/api\/v1\/admin\/organizations\/([^/]+)\/deletion$/)

    if ((request.method() === "GET" && deletionMatch) || (request.method() === "DELETE" && organizationMatch)) {
      const uuid = (deletionMatch ?? organizationMatch)![1]
      const organization = orgs.find((item) => item.uuid === uuid)

      if (!organization) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }

      const blockers = organization.devices_count ? [{ key: "devices", label: "Devices", count: organization.devices_count }] : []

      if (request.method() === "GET") {
        const removes = [
          { key: "members", label: "Members (their accounts stay)", count: organization.users_count },
          { key: "roles", label: "Roles", count: roles.filter((role) => role.organization.uuid === uuid).length },
        ].filter((entry) => entry.count > 0)
        await fulfillJson(route, {
          data: { organization: { uuid, name: organization.name, slug: organization.slug }, deletable: blockers.length === 0, blockers, removes },
        })
        return
      }

      if (url.searchParams.get("slug") !== organization.slug) {
        await unprocessable(route, "slug", "Type the organization's slug exactly to confirm.")
        return
      }

      if (blockers.length > 0 || options.deleteConflicts?.includes(uuid)) {
        await fulfillJson(
          route,
          {
            message: "This organization still holds data that blocks deletion.",
            blockers: blockers.length > 0 ? blockers : [{ key: "devices", label: "Devices", count: 1 }],
          },
          409,
        )
        return
      }

      orgs.splice(orgs.indexOf(organization), 1)
      await route.fulfill({ status: 204 })
      return
    }

    const membersMatch = url.pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/members$/)

    if (request.method() === "GET" && membersMatch) {
      const organizationUuid = membersMatch[1]
      const members = users
        .filter((item) => item.organizations.some((organization) => organization.uuid === organizationUuid))
        .map((item) => ({
          id: item.id,
          name: item.name,
          email: item.email,
          roles: roles
            .filter((role) => memberRoles.get(`${organizationUuid}:${item.id}`)?.includes(role.id))
            .map(({ id, key, display_name, is_default }) => ({ id, key, display_name, is_default })),
        }))

      await fulfillJson(route, paginated(members, url))
      return
    }

    const memberMatch = url.pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/members\/(\d+)$/)

    if (memberMatch && ["PUT", "DELETE"].includes(request.method())) {
      const [, organizationUuid, userId] = memberMatch
      const key = `${organizationUuid}:${userId}`
      const member = users.find((item) => item.id === Number(userId))

      if (request.method() === "PUT") {
        const payload = request.postDataJSON() as { role_ids: number[] }
        memberRoles.set(key, payload.role_ids)
        await fulfillJson(route, { data: { id: member?.id, name: member?.name, email: member?.email, roles: [] } })
        return
      }

      const otherAdministrator = [...memberRoles.entries()].some(
        ([otherKey, roleIds]) => otherKey.startsWith(`${organizationUuid}:`) && otherKey !== key && roleIds.includes(1),
      )

      if (memberRoles.get(key)?.includes(1) && !otherAdministrator) {
        await unprocessable(route, "member", "An organization must retain at least one Organization Admin.")
        return
      }

      memberRoles.delete(key)
      if (member) member.organizations = member.organizations.filter((item) => item.uuid !== organizationUuid)
      await route.fulfill({ status: 204 })
      return
    }

    if (request.method() === "GET" && url.pathname === "/api/v1/admin/users") {
      const search = url.searchParams.get("search")?.toLocaleLowerCase() ?? ""
      const organization = url.searchParams.get("organization")
      const results = users.filter(
        (directoryUser) =>
          (directoryUser.name.toLocaleLowerCase().includes(search) ||
            directoryUser.email.toLocaleLowerCase().includes(search)) &&
          (!organization ||
            directoryUser.organizations.some((item) => item.uuid === organization)),
      )

      await fulfillJson(route, paginated(results, url))
      return
    }

    const platformTeamMatch = url.pathname.match(/^\/api\/v1\/admin\/platform-team\/(\d+)$/)

    if (request.method() === "PUT" && platformTeamMatch) {
      const target = users.find((item) => item.id === Number(platformTeamMatch[1]))
      const payload = request.postDataJSON() as { is_platform_administrator: boolean }

      if (!user.is_super_admin) {
        await fulfillJson(route, { message: "This action is unauthorized." }, 403)
        return
      }

      if (!target) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }

      target.platform_roles = payload.is_platform_administrator
        ? [{ key: "platform-administrator", display_name: "Platform Administrator" }]
        : []
      const { organizations: _organizations, ...member } = target
      await fulfillJson(route, { data: member })
      return
    }

    if (request.method() === "GET" && url.pathname === "/api/v1/admin/roles") {
      const search = url.searchParams.get("search")?.toLocaleLowerCase() ?? ""
      const organization = url.searchParams.get("organization")
      const results = roles.filter(
        (role) =>
          (role.display_name.toLocaleLowerCase().includes(search) ||
            role.key.toLocaleLowerCase().includes(search)) &&
          (!organization || role.organization.uuid === organization),
      )

      await fulfillJson(route, paginated(results, url))
      return
    }

    if (request.method() === "GET" && url.pathname === "/api/v1/admin/invitations") {
      await fulfillJson(route, paginated(invitations, url))
      return
    }

    const organizationRoleMatch = url.pathname.match(/^\/api\/v1\/admin\/organizations\/([^/]+)\/roles$/)

    if (request.method() === "GET" && organizationRoleMatch) {
      await fulfillJson(route, {
        data: roles.filter((role) => role.organization.uuid === organizationRoleMatch[1]),
      })
      return
    }

    const createInvitationMatch = url.pathname.match(/^\/api\/v1\/admin\/organizations\/([^/]+)\/invitations$/)

    if (request.method() === "POST" && createInvitationMatch) {
      const organization = orgs.find((item) => item.uuid === createInvitationMatch[1])
      const payload = request.postDataJSON() as { email?: string; role_ids?: number[] }

      if (
        users.some(
          (item) =>
            item.email === payload.email &&
            item.organizations.some((member) => member.uuid === organization?.uuid),
        )
      ) {
        await unprocessable(route, "email", "This user already belongs to the organization.")
        return
      }

      for (const earlier of invitations) {
        if (earlier.email === payload.email && earlier.organization?.uuid === organization?.uuid && earlier.status === "pending") {
          earlier.status = "revoked"
          earlier.revoked_at = "2026-08-24T12:00:00.000000Z"
        }
      }

      const invitation = {
        uuid: `invite-${invitations.length + 1}`,
        email: payload.email ?? "",
        role_ids: payload.role_ids ?? [],
        roles: roles
          .filter((role) => payload.role_ids?.includes(role.id))
          .map(({ id, display_name }) => ({ id, display_name })),
        grants_super_admin: false,
        organization: organization ?? organizations[0],
        expires_at: "2026-09-01T12:00:00.000000Z",
        accepted_at: null,
        revoked_at: null,
        status: "pending",
      }

      invitations.unshift(invitation)
      await fulfillJson(route, { data: invitation }, 201)
      return
    }

    if (request.method() === "POST" && url.pathname === "/api/v1/admin/super-administrators/invitations") {
      const payload = request.postDataJSON() as { email: string }

      if (!user.is_super_admin) {
        await fulfillJson(route, { message: "This action is unauthorized." }, 403)
        return
      }

      if (users.some((item) => item.email === payload.email && item.is_super_admin)) {
        await unprocessable(route, "email", "This user is already a super administrator.")
        return
      }

      for (const earlier of invitations) {
        if (earlier.email === payload.email && earlier.grants_super_admin && earlier.status === "pending") {
          earlier.status = "revoked"
          earlier.revoked_at = "2026-08-24T12:00:00.000000Z"
        }
      }

      const invitation = {
        uuid: `invite-${invitations.length + 1}`,
        email: payload.email,
        role_ids: [],
        roles: [],
        grants_super_admin: true,
        organization: null,
        expires_at: "2026-09-01T12:00:00.000000Z",
        accepted_at: null,
        revoked_at: null,
        status: "pending",
      }

      invitations.unshift(invitation)
      await fulfillJson(route, { data: invitation }, 201)
      return
    }

    const superAdministratorMatch = url.pathname.match(/^\/api\/v1\/admin\/super-administrators\/(\d+)$/)

    if (superAdministratorMatch && ["PUT", "DELETE"].includes(request.method())) {
      const target = users.find((item) => item.id === Number(superAdministratorMatch[1]))

      if (!user.is_super_admin) {
        await fulfillJson(route, { message: "This action is unauthorized." }, 403)
        return
      }

      if (!target) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }

      if (request.method() === "DELETE") {
        if (target.id === user.id) {
          await unprocessable(route, "user", "You cannot remove your own super administrator access.")
          return
        }

        target.is_super_admin = false
        await route.fulfill({ status: 204 })
        return
      }

      target.is_super_admin = true
      await fulfillJson(route, { data: target })
      return
    }

    const revokeInvitationMatch = url.pathname.match(/^\/api\/v1\/admin\/invitations\/([^/]+)$/)

    if (request.method() === "DELETE" && revokeInvitationMatch) {
      const invitation = invitations.find((item) => item.uuid === revokeInvitationMatch[1])

      if (!invitation) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }

      invitation.status = "revoked"
      invitation.revoked_at = "2026-08-24T12:00:00.000000Z"
      await route.fulfill({ status: 204 })
      return
    }

    const publicInvitationMatch = url.pathname.match(/^\/api\/v1\/invitations\/([^/]+)(\/accept)?$/)

    if (publicInvitationMatch) {
      const token = publicInvitationMatch[1]
      const grantsSuperAdmin = token === "super-admin-invite-token"
      const acceptanceMode = token === "existing-invite-token" ? "sign_in" : "create_account"
      const email = acceptanceMode === "sign_in" ? "existing.user@example.test" : "new.user@example.test"

      if (request.method() === "GET" && !publicInvitationMatch[2]) {
        await fulfillJson(route, {
          data: {
            grants_super_admin: grantsSuperAdmin,
            organization: grantsSuperAdmin ? null : organizations[0],
            email,
            expires_at: "2026-09-01T12:00:00.000000Z",
            acceptance_mode: acceptanceMode,
          },
        })
        return
      }

      if (request.method() === "POST" && publicInvitationMatch[2]) {
        await fulfillJson(route, {
          data: grantsSuperAdmin
            ? { ...superAdmin, id: 6, name: "New Admin", email, organizations: [] }
            : { ...tenantUser, email },
        })
        return
      }
    }

    const roleDetailMatch = url.pathname.match(/^\/api\/v1\/admin\/roles\/(\d+)$/)

    if (request.method() === "GET" && roleDetailMatch) {
      if (options.roleDetailStatus) {
        await fulfillJson(route, { message: "Unable to load role." }, options.roleDetailStatus)
        return
      }

      const detail = roleDetail(Number(roleDetailMatch[1]))

      if (!detail) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }

      await fulfillJson(route, { data: detail })
      return
    }

    const ceilingMatch = url.pathname.match(/^\/api\/v1\/admin\/organizations\/([^/]+)\/permissions$/)

    if (ceilingMatch) {
      const organization = orgs.find((item) => item.uuid === ceilingMatch[1])
      if (!organization) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }
      if (request.method() === "PUT") {
        const payload = request.postDataJSON() as { restricted: boolean; permission_names: string[] }
        ceiling.restricted = payload.restricted
        ceiling.names = payload.restricted ? payload.permission_names : tenantPermissions.map((permission) => permission.name)
      }
      await fulfillJson(route, {
        data: {
          organization,
          restricted: ceiling.restricted,
          permission_names: ceiling.names,
          catalogue: tenantPermissions,
        },
      })
      return
    }

    const rolePermissionMatch = url.pathname.match(/^\/api\/v1\/admin\/roles\/(\d+)\/permissions$/)

    if (request.method() === "PUT" && rolePermissionMatch) {
      const detail = roleDetail(Number(rolePermissionMatch[1]))
      const payload = request.postDataJSON() as { permission_names?: unknown }

      if (!detail || !detail.permissions_editable || !Array.isArray(payload.permission_names)) {
        await fulfillJson(route, { message: "Unable to update role." }, 422)
        return
      }

      rolePermissions.set(detail.id, new Set(payload.permission_names.filter((name): name is string => typeof name === "string")))
      await fulfillJson(route, { data: roleDetail(detail.id) })
      return
    }

    const tenantPermissionsMatch = url.pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/role-permissions$/)

    if (request.method() === "GET" && tenantPermissionsMatch) {
      // A platform administrator can grant the organization's whole ceiling.
      await fulfillJson(route, {
        data: tenantPermissions
          .filter((permission) => ceiling.names.includes(permission.name))
          .map((permission) => ({ ...permission, grantable: true })),
      })
      return
    }

    const tenantRolesMatch = url.pathname.match(/^\/api\/v1\/organizations\/([^/]+)\/roles(?:\/(\d+))?$/)

    if (tenantRolesMatch && ["POST", "PATCH", "DELETE"].includes(request.method())) {
      const [, organizationUuid, roleId] = tenantRolesMatch
      const organization = orgs.find((item) => item.uuid === organizationUuid)
      const existing = roles.find((role) => role.id === Number(roleId) && role.organization.uuid === organizationUuid)

      if (!organization || (roleId && !existing)) {
        await fulfillJson(route, { message: "Not found." }, 404)
        return
      }

      if (request.method() === "DELETE" && existing) {
        if (existing.is_default) {
          await unprocessable(route, "role", "Default organization roles cannot be deleted.")
          return
        }
        if ([...memberRoles.values()].some((roleIds) => roleIds.includes(existing.id))) {
          await unprocessable(route, "role", "Remove this role from members before deleting it.")
          return
        }
        roles.splice(roles.indexOf(existing), 1)
        await route.fulfill({ status: 204 })
        return
      }

      const payload = request.postDataJSON() as { display_name: string; permission_names: string[] }

      if (roles.some((role) => role !== existing && role.organization.uuid === organizationUuid && role.display_name === payload.display_name)) {
        await unprocessable(route, "display_name", "A role with this name already exists in the organization.")
        return
      }

      const role = existing ?? {
        id: Math.max(...roles.map((item) => item.id)) + 1,
        key: `custom-${roles.length + 1}`,
        display_name: payload.display_name,
        is_default: false,
        permissions_count: 0,
        organization,
      }
      if (!existing) roles.push(role)
      role.display_name = payload.display_name
      role.permissions_count = payload.permission_names.length
      rolePermissions.set(role.id, new Set(payload.permission_names))

      await fulfillJson(
        route,
        {
          data: {
            id: role.id,
            key: role.key,
            display_name: role.display_name,
            is_default: role.is_default,
            is_administrator: role.key === "organization-admin",
            manageable: role.key !== "organization-admin",
            permissions: tenantPermissions.filter((permission) => payload.permission_names.includes(permission.name)),
          },
        },
        existing ? 200 : 201,
      )
      return
    }

    await fulfillJson(route, { message: "Not found." }, 404)
  })
}

/** The admin AI assistant settings (spec 010), starting on OpenAI from the server environment. */
async function mockAssistantSettings(page: Page) {
  const models = {
    openai: [{ id: "gpt-5.4-mini-2026-03-17", label: "GPT-5.4 mini", input_usd_per_million: 0.75, output_usd_per_million: 4.5 }],
    anthropic: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", input_usd_per_million: 4, output_usd_per_million: 20 },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", input_usd_per_million: 2, output_usd_per_million: 10 },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", input_usd_per_million: 0.1, output_usd_per_million: 0.5 },
    ],
  }
  const settings = {
    enabled: true,
    help_enabled: true,
    configured: true,
    provider: "openai",
    model: "gpt-5.4-mini-2026-03-17",
    daily_budget_usd: 2,
    run_budget_usd: 0.04,
    sources: { provider: "environment", daily_budget_usd: "environment", run_budget_usd: "environment" },
    revision: 0,
    updated_at: null as string | null,
    today: { spent_usd: 0.12, reserved_usd: 0 },
    providers: [
      { id: "openai", label: "OpenAI", default_model: "gpt-5.4-mini-2026-03-17", models: models.openai, key: { source: "environment" as string | null, last_four: "1111" as string | null, updated_at: null as string | null } },
      { id: "anthropic", label: "Anthropic", default_model: "claude-opus-5-5", models: models.anthropic, key: { source: null as string | null, last_four: null as string | null, updated_at: null as string | null } },
    ],
  }
  await page.route("**/api/v1/admin/assistant-settings**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === "GET") return fulfillJson(route, { data: settings })
    if (request.method() === "POST" && path.endsWith("/test")) {
      const payload = request.postDataJSON() as { api_key?: string }
      return fulfillJson(route, {
        data: payload.api_key?.includes("wrong")
          ? { ok: false, latency_ms: 210, error: "invalid x-api-key" }
          : { ok: true, latency_ms: 840, error: null },
      })
    }
    if (request.method() === "PUT") {
      const payload = request.postDataJSON() as { provider: string; model: string; daily_budget_usd: number; run_budget_usd: number; api_key?: string }
      Object.assign(settings, {
        provider: payload.provider,
        model: payload.model,
        daily_budget_usd: payload.daily_budget_usd,
        run_budget_usd: payload.run_budget_usd,
        revision: settings.revision + 1,
        sources: { provider: "saved", daily_budget_usd: "saved", run_budget_usd: "saved" },
      })
      const provider = settings.providers.find((item) => item.id === payload.provider)!
      if (payload.api_key) provider.key = { source: "saved", last_four: payload.api_key.slice(-4), updated_at: new Date().toISOString() }
      return fulfillJson(route, { data: settings })
    }
    return fulfillJson(route, { message: "Not found." }, 404)
  })
}

const test = base.extend<{ consoleMessages: string[] }>({
  consoleMessages: [
    async ({ page }, use) => {
      const messages: string[] = []

    page.on("console", (message) => {
      const isExpectedUnauthenticatedResponse =
        message.type() === "error" &&
        message.location().url.includes("/api/v1/me") &&
        message.text().includes("401 (Unauthorized)")

      if (["error", "warning"].includes(message.type()) && !isExpectedUnauthenticatedResponse) {
        messages.push(`${message.type()}: ${message.text()}`)
      }
      })
      page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`))

      await use(messages)
      expect(messages).toEqual([])
    },
    { auto: true },
  ],
})

for (const account of [superAdmin, platformAdmin]) {
  test(`${account.name} signs in and navigates the platform directories`, async ({ page }) => {
    await mockApi(page, { initiallyAuthenticated: false, user: account })
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Sign in to IoT OS" })).toBeVisible()
    await page.getByRole("textbox", { name: "Email" }).fill(account.email)
    await page.getByRole("textbox", { name: "Password" }).fill("password")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page).toHaveURL(/\/organizations$/)
    await expect(page.getByRole("row", { name: /Acme Manufacturing/ })).toBeVisible()

    await page.getByRole("link", { name: "Users" }).click()
    await expect(page).toHaveURL(/\/users$/)
    await expect(page.getByRole("row", { name: /Shared Operations Admin/ })).toBeVisible()

    await page.getByRole("link", { name: "Roles" }).click()
    await expect(page).toHaveURL(/\/roles$/)
    await expect(page.getByRole("row", { name: /Organization Admin/ })).toBeVisible()
  })
}

test("keeps user search and organization filters in the URL", async ({ page }) => {
  await mockApi(page)
  await page.goto("/users")

  // Search applies as you type.
  await page.getByRole("searchbox", { name: "Search" }).fill("Shared")

  await expect(page).toHaveURL(/search=Shared/)
  await expect(page.getByRole("row", { name: /Shared Operations Admin/ })).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Member/ })).toHaveCount(0)

  await page.getByRole("searchbox", { name: "Search" }).fill("")
  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Northstar Utilities" }).click()
  await page.keyboard.press("Escape")

  await expect(page).toHaveURL(new RegExp(`organization=${organizations[1].uuid}`))
  await expect(page.getByRole("row", { name: /Northstar Member/ })).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Member/ })).toHaveCount(0)
})

test("blocks tenant-only accounts from the platform administration shell", async ({ page }) => {
  await mockApi(page, { user: tenantUser })
  await page.goto("/")

  await expect(
    page.getByRole("heading", { name: "Platform administration access required" }),
  ).toBeVisible()
  await expect(page.getByRole("alert")).toContainText("shared.operator@example.test")
  await expect(page.getByRole("link", { name: "Organizations" })).toHaveCount(0)
})

test("opens the mobile Sidebar and closes it after navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible()
  await page.getByRole("link", { name: "Users" }).click()

  await expect(page).toHaveURL(/\/users$/)
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  await expect(page.getByRole("dialog")).toBeHidden()
})

test("manages role permissions by group and preserves changes until saving", async ({ page }) => {
  await mockApi(page)
  await page.goto("/roles")

  await page.getByRole("link", { name: "Moderator" }).click()
  await expect(page).toHaveURL(/\/roles\/2$/)
  await expect(page.getByRole("heading", { name: "Moderator" })).toBeVisible()

  const organizationGroup = page.getByRole("checkbox", {
    name: "Select all Organization permissions",
  })
  await expect(organizationGroup).toHaveAttribute("data-state", "indeterminate")
  await organizationGroup.click()
  await expect(page.getByText("2 of 2 selected")).toBeVisible()
  await expect(page.getByText("Unsaved permission changes")).toBeVisible()

  await page.getByRole("button", { name: "Reset changes" }).click()
  await expect(page.getByText("All changes saved")).toBeVisible()

  await organizationGroup.click()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("All changes saved")).toBeVisible()

  await page.getByRole("combobox", { name: "Filter by permission group" }).click()
  await page.getByRole("option", { name: "Members" }).click()
  await page.getByRole("searchbox", { name: "Search permissions" }).fill("view-any")
  await page.getByRole("button", { name: "Search" }).click()

  await expect(page).toHaveURL(/group=User/)
  await expect(page).toHaveURL(/search=view-any/)
  await expect(page.getByText("List members")).toBeVisible()
  await expect(page.getByText("View organization")).toHaveCount(0)

  await page.getByRole("button", { name: "Moderator" }).click()
  await page.getByRole("option", { name: /Member.*Northstar Utilities/ }).click()

  await expect(page).toHaveURL(/\/roles\/3$/)
  await expect(page.getByRole("heading", { name: "Member", exact: true })).toBeVisible()
  await expect(page.getByText("Northstar Utilities · Default role · 1 of 5 selected")).toBeVisible()
})

test("asks before discarding unsaved permission changes", async ({ page }) => {
  await mockApi(page)
  await page.goto("/roles/2")

  await page.getByRole("checkbox", { name: "Select all Organization permissions" }).click()
  await expect(page.getByText("Unsaved permission changes")).toBeVisible()

  await page.getByRole("button", { name: "Moderator" }).click()
  await page.getByRole("option", { name: /Member.*Northstar Utilities/ }).click()
  const guard = page.getByRole("alertdialog", { name: "Discard unsaved permission changes?" })
  await expect(guard).toContainText("1 added and 0 removed")
  await guard.getByRole("button", { name: "Keep editing" }).click()
  await expect(guard).toBeHidden()
  await expect(page).toHaveURL(/\/roles\/2$/)
  await expect(page.getByText("Unsaved permission changes")).toBeVisible()

  await page.getByRole("link", { name: "Back to Roles" }).click()
  await guard.getByRole("button", { name: "Discard changes" }).click()
  await expect(page).toHaveURL(/\/roles$/)
  await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible()
})

test("saved toasts stack above the sticky permission bar on a phone", async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto("/roles/2")

  const group = page.getByRole("checkbox", { name: "Select all Organization permissions" })
  await group.click()
  await page.getByRole("button", { name: "Save changes" }).click()
  const toast = page.locator("[data-sonner-toast]")
  await expect(toast).toContainText("Permissions saved for Moderator")
  // The bar wraps on a phone; the toast settles above it rather than over its buttons.
  const bar = page.getByRole("button", { name: "Reset changes" }).locator("..")
  await expect
    .poll(async () => {
      const [placed, pinned] = [await toast.boundingBox(), await bar.boundingBox()]
      return placed!.y + placed!.height <= pinned!.y
    })
    .toBe(true)
  await group.click()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("All changes saved")).toBeVisible()
})

test("shows Organization Admin permissions as protected", async ({ page }) => {
  await mockApi(page)
  await page.goto("/roles/1")

  await expect(page.getByRole("heading", { name: "Organization Admin" })).toBeVisible()
  await expect(page.getByRole("alert")).toContainText("Permission baseline protected")
  await expect(
    page.getByRole("checkbox", { name: "Select all Organization permissions" }),
  ).toBeDisabled()
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
})

test("shows an error when the role permission catalog cannot be loaded", async ({
  page,
  consoleMessages,
}) => {
  await mockApi(page, { roleDetailStatus: 500 })
  await page.goto("/roles/2")

  await expect(page.getByRole("alert")).toContainText("Could not load this role")
  await expect(page.getByRole("link", { name: "Back to Roles" })).toBeVisible()

  // Development StrictMode may request twice; the served production build requests once.
  expect(consoleMessages.length).toBeGreaterThanOrEqual(1)
  expect(consoleMessages.length).toBeLessThanOrEqual(2)
  expect(
    consoleMessages.every((message) =>
      message.includes("Failed to load resource: the server responded with a status of 500 (Internal Server Error)"),
    ),
  ).toBe(true)
  consoleMessages.length = 0
})

test("invites a user and revokes the pending invitation", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto("/users")

  await page.getByRole("button", { name: "Invite user" }).click()
  await page.getByRole("textbox", { name: "Email" }).fill("northstar.member@example.test")
  await page.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Northstar Utilities" }).click()
  await page.getByRole("checkbox", { name: "Member" }).check()
  await page.getByRole("button", { name: "Send invitation" }).click()
  await expect(page.getByText("This user already belongs to the organization.")).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true")

  await page.getByRole("textbox", { name: "Email" }).fill("invitee@example.test")
  await page.getByRole("button", { name: "Send invitation" }).click()

  await expect(page.getByText("Invitation sent to invitee@example.test")).toBeVisible()
  await expect(page.getByRole("cell", { name: "invitee@example.test", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Actions for invitee@example.test" }).click()
  await page.getByRole("menuitem", { name: "Revoke" }).click()
  await page.getByRole("button", { name: "Revoke invitation" }).click()
  await expect(page.getByRole("alertdialog")).toBeHidden()
  await expect(page.getByText("revoked").first()).toBeVisible()

  await page.getByRole("button", { name: "Actions for pending@example.test" }).click()
  await page.getByRole("menuitem", { name: "Resend" }).click()
  await page.getByRole("button", { name: "Resend invitation" }).click()
  await expect(page.getByText("Invitation sent to pending@example.test")).toBeVisible()

  expect(consoleMessages).toHaveLength(1)
  expect(consoleMessages[0]).toContain("status of 422")
  consoleMessages.length = 0
})

test("creates and edits an organization", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "New organization" }).click()
  await page.getByRole("textbox", { name: "Name" }).fill("Harbor Logistics")
  await expect(page.getByRole("textbox", { name: "Slug" })).toHaveValue("harbor-logistics")
  await page.getByRole("button", { name: "Create organization" }).click()

  await expect(page.getByText("Harbor Logistics created")).toBeVisible()
  await expect(page.getByRole("row", { name: /Harbor Logistics/ })).toBeVisible()

  await page.getByRole("button", { name: "Actions for Harbor Logistics" }).click()
  await page.getByRole("menuitem", { name: "Edit organization" }).click()
  await page.getByRole("textbox", { name: "Slug" }).fill("acme-manufacturing")
  await page.getByRole("button", { name: "Save organization" }).click()
  await expect(page.getByText("The slug has already been taken.")).toBeVisible()

  await page.getByRole("textbox", { name: "Name" }).fill("Harbor Freight")
  await page.getByRole("textbox", { name: "Slug" }).fill("harbor-freight")
  await page.getByRole("button", { name: "Save organization" }).click()
  await expect(page.getByText("Harbor Freight saved")).toBeVisible()
  await expect(page.getByRole("row", { name: /Harbor Freight harbor-freight/ })).toBeVisible()

  expect(consoleMessages).toHaveLength(1)
  expect(consoleMessages[0]).toContain("status of 422")
  consoleMessages.length = 0
})

test("restricts an organization's available permissions after confirming removals", async ({ page }) => {
  await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "Actions for Acme Manufacturing" }).click()
  await page.getByRole("menuitem", { name: "Available permissions" }).click()
  await expect(page.getByRole("heading", { name: "Available permissions" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "All permissions" })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "List members" })).toBeDisabled()

  await page.getByRole("radio", { name: "Only selected permissions" }).click()
  await page.getByRole("checkbox", { name: "Select all Organization permissions" }).click()
  await expect(page.getByText("Unsaved changes")).toBeVisible()
  await page.getByRole("button", { name: "Save changes" }).click()

  const confirm = page.getByRole("alertdialog", { name: /Remove \d+ permissions from Acme Manufacturing\?/ })
  await expect(confirm).toContainText("including Organization Admin")
  await confirm.getByRole("button", { name: "Remove permissions" }).click()

  await expect(page.getByText("Available permissions saved for Acme Manufacturing")).toBeVisible()
  await expect(page.getByRole("radio", { name: "Only selected permissions" })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Select all Organization permissions" })).not.toBeChecked()
  await expect(page.getByText("All changes saved")).toBeVisible()
})

test("changes a member's roles and removes members", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto("/users")

  await page.getByRole("button", { name: "Actions for Shared Operations Admin" }).click()
  await page.getByRole("menuitem", { name: "Remove member" }).click()
  const removeDialog = page.getByRole("alertdialog", { name: "Remove Shared Operations Admin?" })
  await expect(removeDialog.getByRole("combobox", { name: "Organization" })).toHaveText("Acme Manufacturing")
  await removeDialog.getByRole("button", { name: "Remove member" }).click()
  await expect(removeDialog).toContainText("An organization must retain at least one Organization Admin.")

  await removeDialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Northstar Utilities" }).click()
  await removeDialog.getByRole("button", { name: "Remove member" }).click()
  await expect(page.getByText("Shared Operations Admin removed from Northstar Utilities")).toBeVisible()
  await expect(page.getByRole("row", { name: /Shared Operations Admin/ })).not.toContainText("Northstar Utilities")

  await page.getByRole("button", { name: "Actions for Acme Member" }).click()
  await page.getByRole("menuitem", { name: "Change roles" }).click()
  const rolesDialog = page.getByRole("dialog", { name: "Change roles for Acme Member" })
  await expect(rolesDialog.getByRole("checkbox", { name: "Moderator" })).toBeChecked()
  await rolesDialog.getByRole("checkbox", { name: "Organization Admin" }).check()
  const update = page.waitForRequest((request) => request.method() === "PUT")
  await rolesDialog.getByRole("button", { name: "Save roles" }).click()
  expect((await update).postDataJSON()).toEqual({ role_ids: [2, 1] })
  await expect(page.getByText("Roles updated for Acme Member in Acme Manufacturing")).toBeVisible()

  expect(consoleMessages).toHaveLength(1)
  expect(consoleMessages[0]).toContain("status of 422")
  consoleMessages.length = 0
})

test("asks before discarding organization and member role edits", async ({ page }) => {
  await mockApi(page)
  await page.goto("/users")
  await page.getByRole("link", { name: "Organizations", exact: true }).click()

  await page.getByRole("button", { name: "New organization" }).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  const guard = page.getByRole("alertdialog", { name: "Discard organization changes?" })
  await dialog.getByRole("textbox", { name: "Name" }).fill("Harbor Logistics")

  await page.keyboard.press("Escape")
  await guard.getByRole("button", { name: "Keep editing" }).click()
  await expect(guard).toBeHidden()
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Harbor Logistics")

  await page.goBack()
  await guard.getByRole("button", { name: "Keep editing" }).click()
  await expect(guard).toBeHidden()
  await expect(page).toHaveURL(/\/organizations$/)
  await expect(dialog).toBeVisible()

  await dialog.getByRole("button", { name: "Cancel" }).click()
  await guard.getByRole("button", { name: "Discard changes" }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole("button", { name: "Actions for Acme Manufacturing" }).click()
  await page.getByRole("menuitem", { name: "Edit organization" }).click()
  await expect(page.getByRole("dialog", { name: "Edit organization" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Edit organization" })).toBeHidden()
  await expect(guard).toHaveCount(0)

  await page.getByRole("link", { name: "Users", exact: true }).click()
  await page.getByRole("button", { name: "Actions for Shared Operations Admin" }).click()
  await page.getByRole("menuitem", { name: "Change roles" }).click()
  const rolesDialog = page.getByRole("dialog", { name: "Change roles for Shared Operations Admin" })
  const roleGuard = page.getByRole("alertdialog", { name: "Discard role changes?" })
  await expect(rolesDialog.getByRole("checkbox", { name: "Organization Admin" })).toBeChecked()
  await rolesDialog.getByRole("checkbox", { name: "Moderator" }).check()

  await rolesDialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Northstar Utilities" }).click()
  await roleGuard.getByRole("button", { name: "Keep editing" }).click()
  await expect(roleGuard).toBeHidden()
  await expect(rolesDialog.getByRole("combobox", { name: "Organization" })).toHaveText("Acme Manufacturing")
  await expect(rolesDialog.getByRole("checkbox", { name: "Moderator" })).toBeChecked()

  await rolesDialog.getByRole("button", { name: "Close" }).click()
  await roleGuard.getByRole("button", { name: "Discard changes" }).click()
  await expect(rolesDialog).toBeHidden()
})

test("distinguishes an empty directory from a filtered one", async ({ page }) => {
  await mockApi(page)
  await page.goto("/organizations?search=nothing-matches")

  await expect(page.getByText("No matching organizations")).toBeVisible()
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(page).toHaveURL(/\/organizations$/)
  await expect(page.getByRole("row", { name: /Acme Manufacturing/ })).toBeVisible()
})

test("creates a new account from an invitation", async ({ page }) => {
  await mockApi(page, { initiallyAuthenticated: false })
  await page.goto("/accept-invitation?token=new-invite-token")

  await page.getByRole("textbox", { name: "Name" }).fill("New User")
  await page.getByLabel("Password", { exact: true }).fill("safe-password")
  await page.getByLabel("Confirm password", { exact: true }).fill("safe-password")
  await page.getByRole("button", { name: "Create account and accept" }).click()

  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible()
  await expect(page.getByText("new.user@example.test")).toBeVisible()
})

test("requires existing invitees to sign in before accepting", async ({ page }) => {
  await mockApi(page, { initiallyAuthenticated: false })
  await page.goto("/accept-invitation?token=existing-invite-token")

  await expect(page.getByRole("heading", { name: "Sign in to accept invitation" })).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill("password")
  await page.getByRole("button", { name: "Sign in and accept" }).click()

  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible()
  await expect(page.getByText("existing.user@example.test")).toBeVisible()
})

test("makes a user a super administrator and removes the access again", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto("/users")

  // A super administrator never removes their own access, and their row has nothing else to offer.
  await expect(page.getByRole("button", { name: "Actions for Platform Super Admin" })).toHaveCount(0)

  await page.getByRole("button", { name: "Actions for Acme Member" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toBeVisible()
  await page.getByRole("menuitem", { name: "Make super administrator" }).click()
  const grantDialog = page.getByRole("alertdialog", { name: "Make Acme Member a super administrator?" })
  await expect(grantDialog).toContainText("every organization")
  await grantDialog.getByRole("button", { name: "Make super administrator" }).click()
  await expect(page.getByText("Acme Member is now a super administrator")).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Member/ })).toContainText("Super admin")

  // A user with no organization can be promoted too.
  await page.getByRole("button", { name: "Actions for Platform Administrator" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Actions for Acme Member" }).click()
  await page.getByRole("menuitem", { name: "Remove super administrator" }).click()
  const revokeDialog = page.getByRole("alertdialog", { name: "Remove super administrator access from Acme Member?" })
  const revoke = page.waitForRequest((request) => request.method() === "DELETE")
  await revokeDialog.getByRole("button", { name: "Remove access" }).click()
  expect((await revoke).url()).toContain("/api/v1/admin/super-administrators/4")
  await expect(page.getByText("Acme Member is no longer a super administrator")).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Member/ })).toContainText("Tenant user")

  expect(consoleMessages).toEqual([])
})

test("invites a super administrator", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto("/users")

  await page.getByRole("button", { name: "Invite user" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite user" })
  await expect(dialog.getByRole("radio", { name: "Organization member" })).toBeChecked()
  await dialog.getByRole("radio", { name: "Super administrator" }).click()
  await expect(dialog.getByRole("combobox", { name: "Organization" })).toHaveCount(0)

  await dialog.getByRole("textbox", { name: "Email" }).fill("super-admin@example.test")
  await dialog.getByRole("button", { name: "Send invitation" }).click()
  await expect(dialog.getByText("This user is already a super administrator.")).toBeVisible()

  await dialog.getByRole("textbox", { name: "Email" }).fill("new.admin@example.test")
  const invite = page.waitForRequest((request) => request.method() === "POST")
  await dialog.getByRole("button", { name: "Send invitation" }).click()
  expect((await invite).url()).toContain("/api/v1/admin/super-administrators/invitations")
  await expect(page.getByText("Invitation sent to new.admin@example.test")).toBeVisible()

  const row = page.getByRole("row", { name: /new\.admin@example\.test/ })
  await expect(row).toContainText("All organizations")
  await expect(row).toContainText("Super administrator")

  await page.getByRole("button", { name: "Actions for new.admin@example.test" }).click()
  await page.getByRole("menuitem", { name: "Resend" }).click()
  const resend = page.waitForRequest((request) => request.method() === "POST")
  await page.getByRole("button", { name: "Resend invitation" }).click()
  expect((await resend).url()).toContain("/api/v1/admin/super-administrators/invitations")
  await expect(page.getByRole("alertdialog")).toBeHidden()
  // The first toast may still be showing.
  await expect(page.getByText("Invitation sent to new.admin@example.test").last()).toBeVisible()

  expect(consoleMessages).toHaveLength(1)
  expect(consoleMessages[0]).toContain("status of 422")
  consoleMessages.length = 0
})

test("platform administrators cannot grant super administrator access", async ({ page }) => {
  await mockApi(page, { user: platformAdmin })
  await page.goto("/users")

  await page.getByRole("button", { name: "Actions for Acme Member" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Make super administrator" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Actions for Platform Super Admin" })).toHaveCount(0)

  await page.getByRole("button", { name: "Invite user" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite user" })
  await expect(dialog.getByRole("combobox", { name: "Organization" })).toBeVisible()
  await expect(dialog.getByRole("radio")).toHaveCount(0)
})

test("creates a super administrator account from an invitation", async ({ page }) => {
  await mockApi(page, { initiallyAuthenticated: false })
  await page.goto("/accept-invitation?token=super-admin-invite-token")

  await expect(page.getByText("You have been invited to administer IoT OS as new.user@example.test.")).toBeVisible()
  await page.getByRole("textbox", { name: "Name" }).fill("New Admin")
  await page.getByLabel("Password", { exact: true }).fill("safe-password")
  await page.getByLabel("Confirm password", { exact: true }).fill("safe-password")
  await page.getByRole("button", { name: "Create account and accept" }).click()

  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible()
  await expect(page.getByText("You are now a super administrator.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Open administration" })).toHaveAttribute("href", "/")
})

test("makes a user a platform administrator and removes the role again", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto("/users")

  // A super administrator's row offers no role change, and has nothing else to offer.
  await expect(page.getByRole("button", { name: "Actions for Platform Super Admin" })).toHaveCount(0)

  await page.getByRole("button", { name: "Actions for Acme Member" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toBeVisible()
  await page.getByRole("menuitem", { name: "Make platform administrator" }).click()
  const grantDialog = page.getByRole("alertdialog", { name: "Make Acme Member a platform administrator?" })
  await expect(grantDialog).toContainText("manage organizations")
  const grant = page.waitForRequest((request) => request.method() === "PUT")
  await grantDialog.getByRole("button", { name: "Make platform administrator" }).click()
  expect((await grant).url()).toContain("/api/v1/admin/platform-team/4")
  expect((await grant).postDataJSON()).toEqual({ is_platform_administrator: true })
  await expect(page.getByText("Acme Member is now a platform administrator")).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Member/ })).toContainText("Platform administrator")

  await page.getByRole("button", { name: "Actions for Acme Member" }).click()
  await page.getByRole("menuitem", { name: "Remove platform administrator" }).click()
  const revokeDialog = page.getByRole("alertdialog", { name: "Remove platform administrator access from Acme Member?" })
  const revoke = page.waitForRequest((request) => request.method() === "PUT")
  await revokeDialog.getByRole("button", { name: "Remove access" }).click()
  expect((await revoke).postDataJSON()).toEqual({ is_platform_administrator: false })
  await expect(page.getByText("Acme Member is no longer a platform administrator")).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Member/ })).toContainText("Tenant user")

  // A platform administrator without an organization offers only the removal.
  await page.getByRole("button", { name: "Actions for Platform Administrator" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toHaveCount(0)
  await expect(page.getByRole("menuitem", { name: "Remove platform administrator" })).toBeVisible()

  expect(consoleMessages).toEqual([])
})

test("platform administrators cannot change platform administrator access", async ({ page }) => {
  await mockApi(page, { user: platformAdmin })
  await page.goto("/users")

  await page.getByRole("button", { name: "Actions for Acme Member" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Make platform administrator" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Actions for Platform Administrator" })).toHaveCount(0)
})

test("creates a role for an organization from the Roles page", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto(`/roles?organization=${organizations[0].uuid}`)

  await page.getByRole("link", { name: "New role" }).click()
  await expect(page).toHaveURL(new RegExp(`/roles/new\\?organization=${organizations[0].uuid}$`))
  await expect(page.getByRole("heading", { name: "New role" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Organization" })).toHaveText("Acme Manufacturing")
  await expect(page.getByRole("button", { name: "Create role" })).toBeDisabled()

  await page.getByRole("textbox", { name: "Role name" }).fill("Moderator")
  await page.getByRole("checkbox", { name: "View organization" }).check()
  await page.getByRole("checkbox", { name: "List members" }).check()
  await expect(page.getByText("2 of 5 selected")).toBeVisible()
  await page.getByRole("button", { name: "Create role" }).click()

  await expect(page.getByText("A role with this name already exists in the organization.")).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Role name" })).toHaveAttribute("aria-invalid", "true")
  await expect(page.getByText("2 of 5 selected")).toBeVisible()
  expect(consoleMessages).toHaveLength(1)
  expect(consoleMessages[0]).toContain("status of 422")
  consoleMessages.length = 0

  await page.getByRole("textbox", { name: "Role name" }).fill("Site Operator")
  await page.getByRole("button", { name: "Create role" }).click()

  await expect(page.getByText("Site Operator created in Acme Manufacturing")).toBeVisible()
  await expect(page).toHaveURL(/\/roles\/4$/)
  await expect(page.getByRole("heading", { name: "Site Operator" })).toBeVisible()
  await expect(page.getByText("Acme Manufacturing · Custom role · 2 of 5 selected")).toBeVisible()

  await page.getByRole("link", { name: "Back to Roles" }).click()
  await expect(page.getByRole("row", { name: /Site Operator/ })).toContainText("Custom")
})

test("asks before discarding a new role", async ({ page }) => {
  await mockApi(page)
  await page.goto("/roles/new")

  await expect(page.getByRole("combobox", { name: "Organization" })).toHaveText("Select an organization")
  await page.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Northstar Utilities" }).click()
  await page.getByRole("textbox", { name: "Role name" }).fill("Auditor")
  await page.getByRole("button", { name: "Cancel" }).click()

  const guard = page.getByRole("alertdialog", { name: "Discard this new role?" })
  await guard.getByRole("button", { name: "Keep editing" }).click()
  await expect(page.getByRole("textbox", { name: "Role name" })).toHaveValue("Auditor")

  await page.getByRole("button", { name: "Cancel" }).click()
  await guard.getByRole("button", { name: "Discard changes" }).click()
  await expect(page).toHaveURL(new RegExp(`/roles\\?organization=${organizations[1].uuid}$`))
})

test("creates an organization, adds a role and invites someone with it", async ({ page }) => {
  await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "New organization" }).click()
  await page.getByRole("textbox", { name: "Name" }).fill("Cedar Processing")
  await page.getByRole("button", { name: "Create organization" }).click()
  await expect(page.getByText("Cedar Processing created")).toBeVisible()

  await page.getByRole("button", { name: "Actions for Cedar Processing" }).click()
  await page.getByRole("menuitem", { name: "New role" }).click()
  await expect(page.getByRole("combobox", { name: "Organization" })).toHaveText("Cedar Processing")
  await page.getByRole("textbox", { name: "Role name" }).fill("Field Engineer")
  await page.getByRole("checkbox", { name: "Select all Organization permissions" }).click()
  await page.getByRole("button", { name: "Create role" }).click()
  await expect(page.getByRole("heading", { name: "Field Engineer" })).toBeVisible()
  await expect(page.getByText("Cedar Processing · Custom role · 2 of 5 selected")).toBeVisible()

  await page.getByRole("link", { name: "Organizations" }).click()
  await page.getByRole("button", { name: "Actions for Cedar Processing" }).click()
  await page.getByRole("menuitem", { name: "Invite user" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite user" })
  await expect(dialog.getByRole("combobox", { name: "Organization" })).toHaveText("Cedar Processing")
  await dialog.getByRole("textbox", { name: "Email" }).fill("engineer@cedar.example.test")
  await dialog.getByRole("checkbox", { name: "Field Engineer" }).check()
  await dialog.getByRole("button", { name: "Send invitation" }).click()
  await expect(page.getByText("Invitation sent to engineer@cedar.example.test")).toBeVisible()
  await expect(dialog).toBeHidden()

  await page.getByRole("button", { name: "Actions for Cedar Processing" }).click()
  await page.getByRole("menuitem", { name: "Roles" }).click()
  await expect(page).toHaveURL(/\/roles\?organization=33333333-3333-4333-8333-333333333333$/)
  await expect(page.getByRole("row", { name: /Field Engineer/ })).toBeVisible()
})

test("preselects the filtered organization when inviting from Users", async ({ page }) => {
  await mockApi(page, { customRoles: true })
  await page.goto(`/users?organization=${organizations[0].uuid}`)

  await page.getByRole("button", { name: "Invite user" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite user" })
  await expect(dialog.getByRole("combobox", { name: "Organization" })).toHaveText("Acme Manufacturing")
  await expect(dialog.getByRole("checkbox", { name: "Field Technician" })).toBeVisible()
})

test("renames and deletes custom roles", async ({ page, consoleMessages }) => {
  await mockApi(page, { customRoles: true })
  await page.goto("/roles/1")
  await expect(page.getByRole("heading", { name: "Organization Admin" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Delete role" })).toHaveCount(0)

  await page.goto("/roles/2")
  await expect(page.getByRole("button", { name: "Rename" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Delete role" })).toHaveCount(0)

  await page.goto("/roles/5")
  await page.getByRole("button", { name: "Delete role" }).click()
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete Shift Lead?" })
  await deleteDialog.getByRole("button", { name: "Delete role" }).click()
  await expect(deleteDialog.getByText("Remove this role from members before deleting it.")).toBeVisible()
  await deleteDialog.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("heading", { name: "Shift Lead" })).toBeVisible()

  await page.goto("/roles/4")
  await page.getByRole("checkbox", { name: "List members" }).check()
  await expect(page.getByText("Unsaved permission changes")).toBeVisible()

  await page.getByRole("button", { name: "Rename" }).click()
  const renameDialog = page.getByRole("dialog", { name: "Rename role" })
  await renameDialog.getByRole("textbox", { name: "Role name" }).fill("Shift Lead")
  await renameDialog.getByRole("button", { name: "Rename role" }).click()
  await expect(renameDialog.getByText("A role with this name already exists in the organization.")).toBeVisible()
  await renameDialog.getByRole("textbox", { name: "Role name" }).fill("Field Engineer")
  await renameDialog.getByRole("button", { name: "Rename role" }).click()
  await expect(page.getByText("Renamed to Field Engineer")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Field Engineer" })).toBeVisible()
  // Renaming sent the saved permissions; the unsaved tick is still pending.
  await expect(page.getByText("Unsaved permission changes")).toBeVisible()

  await page.getByRole("button", { name: "Delete role" }).click()
  await page.getByRole("alertdialog", { name: "Delete Field Engineer?" }).getByRole("button", { name: "Delete role" }).click()
  await expect(page.getByText("Field Engineer deleted")).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/roles\\?organization=${organizations[0].uuid}$`))
  await expect(page.getByRole("row", { name: /Field Engineer/ })).toHaveCount(0)
  await expect(page.getByRole("row", { name: /Shift Lead/ })).toBeVisible()

  expect(consoleMessages).toHaveLength(2)
  expect(consoleMessages.every((message) => message.includes("status of 422"))).toBe(true)
  consoleMessages.length = 0
})

test("deletes an empty organization after its slug is typed", async ({ page }) => {
  await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "New organization" }).click()
  await page.getByRole("textbox", { name: "Name" }).fill("Cedar Processing")
  await page.getByRole("button", { name: "Create organization" }).click()
  await expect(page.getByRole("row", { name: /Cedar Processing/ })).toContainText("0")

  await page.getByRole("button", { name: "Actions for Cedar Processing" }).click()
  await page.getByRole("menuitem", { name: "Delete organization" }).click()
  const dialog = page.getByRole("alertdialog", { name: "Delete Cedar Processing?" })
  await expect(dialog).toContainText("cannot be undone")
  await expect(dialog).toContainText("It holds nothing else.")

  const confirm = dialog.getByRole("button", { name: "Delete organization" })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole("textbox", { name: "Type cedar-processing to confirm" }).fill("Cedar Processing")
  await expect(confirm).toBeDisabled()
  await dialog.getByRole("textbox", { name: "Type cedar-processing to confirm" }).fill("cedar-processing")
  await confirm.click()

  await expect(page.getByText("Cedar Processing deleted")).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("row", { name: /Cedar Processing/ })).toHaveCount(0)
  await expect(page.getByRole("row", { name: /Acme Manufacturing/ })).toBeVisible()
})

test("lists what deletion removes and what blocks it", async ({ page }) => {
  await mockApi(page)
  await page.goto("/organizations")
  await expect(page.getByRole("row", { name: /Acme Manufacturing/ })).toContainText("6")

  await page.getByRole("button", { name: "Actions for Acme Manufacturing" }).click()
  await page.getByRole("menuitem", { name: "Delete organization" }).click()
  const blocked = page.getByRole("alertdialog", { name: "Acme Manufacturing can't be deleted yet" })
  await expect(blocked.getByRole("definition")).toHaveText("6")
  await expect(blocked.getByRole("term")).toHaveText("Devices")
  await expect(blocked.getByRole("button", { name: "Delete organization" })).toHaveCount(0)
  await expect(blocked.getByRole("textbox")).toHaveCount(0)
  await blocked.getByRole("button", { name: "Close" }).click()
  await expect(blocked).toBeHidden()

  await page.getByRole("button", { name: "Actions for Northstar Utilities" }).click()
  await page.getByRole("menuitem", { name: "Delete organization" }).click()
  const dialog = page.getByRole("alertdialog", { name: "Delete Northstar Utilities?" })
  await expect(dialog.getByLabel("What deletion removes")).toContainText("Members (their accounts stay)")
  await expect(dialog.getByLabel("What deletion removes")).toContainText("Roles")
})

test("shows the blockers when one appears before the delete is confirmed", async ({ page, consoleMessages }) => {
  await mockApi(page, { deleteConflicts: [organizations[1].uuid] })
  await page.goto("/organizations")

  await page.getByRole("button", { name: "Actions for Northstar Utilities" }).click()
  await page.getByRole("menuitem", { name: "Delete organization" }).click()
  const dialog = page.getByRole("alertdialog")
  await dialog.getByRole("textbox", { name: "Type northstar-utilities to confirm" }).fill("northstar-utilities")
  await dialog.getByRole("button", { name: "Delete organization" }).click()

  await expect(dialog.getByRole("heading", { name: "Northstar Utilities can't be deleted yet" })).toBeVisible()
  await expect(dialog.getByLabel("What blocks deletion")).toContainText("Devices")
  await expect(dialog.getByRole("button", { name: "Delete organization" })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Close" }).click()
  await expect(page.getByRole("row", { name: /Northstar Utilities/ })).toBeVisible()

  expect(consoleMessages).toHaveLength(1)
  expect(consoleMessages[0]).toContain("status of 409")
  consoleMessages.length = 0
})

test("switches the assistant to Anthropic after testing the key", async ({ page }) => {
  await mockApi(page)
  await mockAssistantSettings(page)
  await page.goto("/organizations")
  await page.getByRole("link", { name: "AI assistant" }).click()

  await expect(page).toHaveURL(/\/settings\/assistant$/)
  await expect(page.getByRole("radio", { name: "OpenAI" })).toBeChecked()
  await expect(page.getByRole("radio", { name: "OpenAI" })).toHaveAccessibleDescription("Server environment key ending in …1111")

  await page.getByRole("radio", { name: "Anthropic" }).click()
  await expect(page.getByRole("combobox", { name: "Anthropic model" })).toContainText("Claude Opus 5.5")
  await expect(page.getByText("Large replies may stop early")).toBeVisible()
  await page.getByRole("combobox", { name: "Anthropic model" }).click()
  await page.getByRole("option", { name: /Claude Sonnet 5\.5/ }).click()
  await page.getByRole("spinbutton", { name: "Per-reply limit (USD)" }).fill("0.1")
  await expect(page.getByText("Large replies may stop early")).toHaveCount(0)

  const key = page.getByLabel("API key", { exact: true })
  await key.fill("sk-ant-wrong-key-000000000")
  await page.getByRole("button", { name: "Test connection" }).click()
  await expect(page.getByText("Connection failed")).toBeVisible()
  await expect(page.getByText("invalid x-api-key")).toBeVisible()

  await key.fill("sk-ant-test-only-key-123456")
  const testRequest = page.waitForRequest((request) => request.url().endsWith("/assistant-settings/test"))
  await page.getByRole("button", { name: "Test connection" }).click()
  expect((await testRequest).postDataJSON()).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", api_key: "sk-ant-test-only-key-123456" })
  await expect(page.getByText("Anthropic · Claude Sonnet 5.5 answered in 840 ms. Nothing was saved.")).toBeVisible()

  const save = page.waitForRequest((request) => request.method() === "PUT")
  await page.getByRole("button", { name: "Save settings" }).click()
  expect((await save).postDataJSON()).toEqual({
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    daily_budget_usd: 2,
    run_budget_usd: 0.1,
    revision: 0,
    api_key: "sk-ant-test-only-key-123456",
  })
  await expect(page.getByText("AI assistant settings saved")).toBeVisible()
  await expect(page.getByRole("radio", { name: "Anthropic" })).toBeChecked()
  await expect(page.getByText("Saved key ending in …3456").first()).toBeVisible()
  await expect(page.getByLabel("Replace key")).toHaveValue("")
  await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled()
})

test("platform administrators do not see the AI assistant settings", async ({ page }) => {
  await mockApi(page, { user: platformAdmin })
  await mockAssistantSettings(page)
  await page.goto("/organizations")

  await expect(page.getByRole("link", { name: "Users" })).toBeVisible()
  await expect(page.getByRole("link", { name: "AI assistant" })).toHaveCount(0)
  await page.goto("/settings/assistant")
  await expect(page).toHaveURL(/\/organizations$/)
})
