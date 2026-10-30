# Contract: Billing accounts API

These operations, and two new fields on organization creation, all sit under `/api/v1`
and behind `auth:sanctum`. They join the generated OpenAPI document
(`contracts/openapi/openapi.json`, ADR-016) under the tags `Platform billing` (admin)
and `Billing` (owners), with typed bodies; none is added to `pending-schemas.json`.
`contracts/openapi/supplements/billing.yaml` adds the "one of" request rule and the
409 and 422 responses that inference misses. `packages/api-client` gains the matching
types and methods in the same pull request.

Billing accounts are identified by `uuid`, and users by integer `id` (ADR-013).
Validation errors use the API's usual 422 shape:
`{"message": "...", "errors": {"field": ["..."]}}`.

## Platform administration

Every operation needs `PlatformAdministration.manageOrganizations`; without it the
answer is 403. A deleted or unknown account is 404.

### `GET admin/billing-accounts`

Query: `search` (matches name or contact email), `page`, `per_page` (1–100, default
25). Ordered by name.

```json
{
  "data": [
    {
      "uuid": "d0000000-0000-4000-8000-000000000001",
      "name": "Example Integrations",
      "contact_email": "billing@example.com",
      "organization_limit": 10,
      "organizations_count": 3,
      "owners": [{ "id": 42, "name": "Pat Example", "email": "pat@example.com" }],
      "created_at": "2026-10-31T09:00:00Z"
    }
  ],
  "links": { "first": "…", "last": "…", "prev": null, "next": null },
  "meta": { "current_page": 1, "last_page": 1, "per_page": 25, "total": 1 }
}
```

### `POST admin/billing-accounts`

Body: `name` (required), `contact_email`, `notes`, `organization_limit` (default 1).
Answers 201 with the detail shape below. It is audited as `billing_account.created`.

### `GET admin/billing-accounts/{account}`

```json
{
  "data": {
    "uuid": "d0000000-0000-4000-8000-000000000001",
    "name": "Example Integrations",
    "contact_email": "billing@example.com",
    "notes": null,
    "organization_limit": 10,
    "organizations_count": 2,
    "created_at": "2026-10-31T09:00:00Z",
    "owners": [
      { "id": 42, "name": "Pat Example", "email": "pat@example.com", "added_at": "2026-10-31T09:05:00Z" }
    ],
    "organizations": [
      {
        "uuid": "a0000000-0000-4000-8000-000000000001",
        "name": "Corner Shop",
        "slug": "corner-shop",
        "users_count": 3,
        "devices_count": 4,
        "assigned_at": "2026-10-31T09:10:00Z"
      }
    ],
    "history": [
      {
        "at": "2026-10-31T09:10:00Z",
        "action": "organization_joined",
        "actor": { "id": 1, "name": "Platform Admin" },
        "details": { "organization": { "uuid": "a0000000-0000-4000-8000-000000000001", "name": "Corner Shop" } }
      }
    ]
  }
}
```

`history` holds the latest 100 entries, newest first. `action` is one of:

- `created`, `updated` (`details.changes`);
- `owner_added`, `owner_removed` (`details.user`);
- `organization_joined`, `organization_left` (`details.organization`).

`actor` is null for the rollout and for changes made outside a request. Deletion is
audited as `billing_account.deleted`, but a deleted account answers 404, so it never
appears in `history`.

### `PATCH admin/billing-accounts/{account}`

Body: any of `name`, `contact_email`, `notes`, `organization_limit`. Answers 200 with
the detail. It is audited as `billing_account.updated` with only the changed fields;
a request that changes nothing writes no event. Setting a limit below
`organizations_count` is allowed.

### `DELETE admin/billing-accounts/{account}`

Answers 204 and soft-deletes the account. When the account still has organizations:

```json
{ "message": "Move this billing account's 2 organizations before deleting it." }
```

with status 409.

### `PUT admin/billing-accounts/{account}/owners/{user}`

No body. Answers 200 with `{"data": [owners…]}`. Adding someone who is already an
owner answers 200 and writes no audit event. An unknown user is 404.

### `DELETE admin/billing-accounts/{account}/owners/{user}`

Answers 204. Removing someone who is not an owner answers 204 and writes no audit
event. Memberships are never touched.

### `PUT admin/organizations/{organization}/billing-account`

Body: `{"billing_account_uuid": "d0000000-0000-4000-8000-000000000002"}`. It closes
the current assignment, opens one on the target account, and records
`organization.billing_account_changed`. Answers 200 with the organization in the admin
list shape (below). When the target is the current account it answers 200 and
changes nothing. The organization limit does not apply.

### `POST admin/organizations` (changed)

The existing body (`name`, `slug`) gains, as alternatives:

- `billing_account_uuid`: attach the new organization to that account;
- `new_billing_account`: `{"name": "Corner Shop", "contact_email": null}`, which
  creates this account with the organization.

With neither, a new account named after the organization is created. Sending both is
422 on `billing_account_uuid`. The organization and a new account are created in one
transaction. Answers 201 with the organization in the admin list shape.

### `GET admin/organizations` (changed)

Each row gains `"billing_account": {"uuid": "…", "name": "…"}`. Other organization
payloads (`/me`, `organizations/{o}/context`, tenant routes) never include
`billing_account`.

## Owners

Billing accounts are looked up among the signed-in person's own non-deleted
accounts. Any other account answers 404, whoever asks.

### `GET billing-accounts`

The accounts the signed-in person owns, ordered by name. It is not paginated: one
person owns few accounts.

```json
{
  "data": [
    {
      "uuid": "d0000000-0000-4000-8000-000000000001",
      "name": "Example Integrations",
      "organization_limit": 10,
      "organizations_count": 2,
      "organizations": [
        { "uuid": "a0000000-0000-4000-8000-000000000001", "name": "Corner Shop", "created_at": "2026-10-31T09:10:00Z", "member": true },
        { "uuid": "a0000000-0000-4000-8000-000000000002", "name": "Home", "created_at": "2026-10-31T09:20:00Z", "member": false }
      ]
    }
  ]
}
```

### `POST billing-accounts/{account}/organizations`

Body: `name` (required) and `slug` (optional; generated when absent). It creates the
organization under the account with the built-in roles, and makes the signed-in owner
its Organization Admin. Answers 201 with the `OrganizationResource` the portal
already uses, including `capabilities`.

At or above the limit:

```json
{
  "message": "This billing account allows 10 organizations. Ask the platform operator to raise the limit.",
  "errors": {
    "billing_account": ["This billing account allows 10 organizations. Ask the platform operator to raise the limit."]
  }
}
```

with status 422. A taken slug is 422 on `slug`.

## Session (changed)

`GET me` → `data.capabilities.billing_accounts` (boolean): whether the person owns at
least one account that has not been deleted.
