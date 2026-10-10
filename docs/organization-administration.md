# Organization administration

Organization administrators manage their own people in the tenant portal. They invite
members, change member roles, remove members and bundle permissions into custom roles.
Platform administrators decide which permissions each organization can use.

## Permission ceiling

Each organization has a **permission ceiling**: the tenant permissions its roles may hold.
Platform administrators edit it in administration under **Organizations › Permissions**.

- **All permissions** is the default. The ceiling is the whole tenant catalogue, which is
  every `web` permission except `PlatformAdministration.*`, including permissions added
  by future features.
- **Only selected permissions** stores an allow-list in `organization_permission` and sets
  `organizations.permissions_restricted`. Permissions added later stay unavailable until
  they are selected.

Narrowing the ceiling removes the dropped permissions from every role in the organization,
in the same transaction, under a lock on the organization row. Widening never re-grants
anything to custom or built-in roles. **Organization Admin always holds exactly the
ceiling**, so it gains widened permissions, and nobody edits its bundle directly.

The ceiling also limits the platform role-permission editor (`PUT admin/roles/{role}/permissions`).
Permission seeders that backfill built-in roles reconcile restricted organizations afterwards
(`OrganizationPermissionCeiling::reconcile`). A migration that grants new tenant permissions
to existing roles must do the same.

## No escalation

Platform administrators can grant the whole ceiling. Anyone else can grant only permissions
that are **inside the ceiling and held by them** in that organization, through roles or
direct grants (`OrganizationGrants`). The API enforces this; the UI only reflects it.

| Action | Requires | Also requires |
| --- | --- | --- |
| Create or edit a role | `Role.create` / `Role.update` | New permissions are grantable. When editing, the role's current permissions are grantable too. |
| Delete a role | `Role.delete` | The role is custom, unused, not referenced by a pending invitation, and its permissions are grantable |
| Change a member's roles | `User.update` | Every selected role is grantable, and so is everything the member holds now |
| Remove a member | `User.delete` | Everything the member holds is grantable |
| Invite, send again, revoke | `User.create` | Every role on the invitation is grantable |

Organization Admins hold the whole ceiling, so they can manage every member and promote
others to Organization Admin. A custom role with partial `User.*` or `Role.*` access cannot
assign Organization Admin, build a role above itself, or demote or remove an administrator.

An organization always keeps at least one Organization Admin. Role changes and removals
that could take away the last one run in a transaction that locks the organization row.
Platform-created organizations get the built-in roles (Organization Admin, Moderator, Member)
inside their ceiling, so a platform administrator can invite the first administrator.

Violations return 422 with a field error (`permission_names`, `role_ids`, `role`, `member`
or `invitation`). Missing base permissions return 403, and resources in other organizations
return 404.

## API

All routes are under `/api/v1/organizations/{organization_uuid}` with session or user-token
authentication.

| Method and suffix | Notes |
| --- | --- |
| GET `members?search=&page=&per_page=` | Name or email search. Each member has `is_current_user` and `manageable`. |
| PUT `members/{user_id}` | `{role_ids}` |
| DELETE `members/{user_id}` | Removes the membership and its roles |
| GET `roles` | `members_count`, `is_administrator`, `assignable` and `manageable`. Allowed with `Role.view-any`, `User.create` or `User.update`, because invite and role pickers need it. |
| GET `role-permissions` | The ceiling, each permission with `grantable` |
| POST `roles`, PATCH `roles/{id}`, DELETE `roles/{id}` | `{display_name, permission_names}` |
| GET `invitations?status=pending\|expired` | Open invitations, with roles and inviter |
| POST `invitations` | `{email, role_ids}`; replaces a pending invitation for the same email |
| POST `invitations/{uuid}/resend` | New token and seven-day expiry, same uuid; the old link stops working |
| DELETE `invitations/{uuid}` | Pending only |

Inviting and sending again are limited to 20 per minute per user and 200 per day per
organization. Platform administrators read and replace the ceiling with GET and PUT
`/api/v1/admin/organizations/{organization_uuid}/permissions`, using `{restricted, permission_names}`.

Session payloads add `capabilities.administration` to each organization. It holds
`members_view`, `invite`, `members_update`, `members_remove`, `roles_view`, `roles_create`,
`roles_update` and `roles_delete`. The portal shows these screens only to people who can
manage them, so listing alone (the built-in Moderator) does not show them:

- **Organization › Members** needs `members_view` and at least one of `invite`,
  `members_update` or `members_remove`.
- **Roles** needs `roles_view` and at least one of `roles_create`, `roles_update` or
  `roles_delete`.

The API still authorizes each request by permission.

## Portal

- **Members** has two tabs:
  - **People**: search, plus change roles or remove from each member's actions menu.
  - **Invitations**: send again or revoke.
- **Invite people** opens a sheet with an email address and role checkboxes. Roles with
  permissions the inviter doesn't hold stay visible but locked.
- **Roles** lists the built-in and custom roles. The role editor uses the shared permission
  matrix (`@iot-os/ui/components/permission-matrix`). Permissions the editor can't grant are
  locked, and Organization Admin is read-only.
- Accepting an invitation in the portal links straight to the organization just joined.
