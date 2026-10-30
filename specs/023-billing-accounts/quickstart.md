# Quickstart: Billing Accounts

How to prove the feature works, delivery by delivery. Request and response shapes are
in [the contract](contracts/billing-accounts-api.md), and tables and invariants in
[the data model](data-model.md).

## Prerequisites

- The local stack is running ([local setup](../../docs/dev/local-setup.md)), with at
  least two organizations and a few users (the demo seed is enough).
- You can sign in to the admin app as a super administrator, and to the portal as an
  ordinary user who is not a platform administrator ("the owner").

## Automated checks

```sh
cd apps/api && php artisan test --compact --filter='Billing|OrganizationDeletion'
cd apps/api && php artisan contract:export --check && php artisan contract:check --base=origin/main
pnpm --filter @iot-os/ui test
pnpm --filter @iot-os/admin lint
pnpm --filter @iot-os/portal lint
pnpm --filter @iot-os/admin test:e2e -- admin.spec.ts billing-accounts.spec.ts
pnpm --filter @iot-os/portal test:e2e -- billing-accounts.spec.ts
```

The PHPUnit run must use PostgreSQL. The backfill, the partial unique index and the
row lock behave differently on SQLite.

## 1. API (delivery 2)

Rebuild `api` and the API-image services the way
[Rebuild one service](../../docs/dev/local-setup.md#rebuild-one-service) describes,
keeping the stack's env files and overlays. The migration runs on start.

**Every organization has exactly one current account (SC-002).** In the
`timescaledb` service:

```sql
select o.uuid
from organizations o
left join billing_account_assignments a
  on a.organization_uuid = o.uuid and a.ended_at is null
where a.id is null or a.billing_account_id <> o.billing_account_id;
```

Expect no rows. Each existing organization has an account with its name and
`organization_limit = 1`.

**No gap or overlap at any moment since rollout (SC-002).** Each assignment must end
exactly when the organization's next one starts:

```sql
select organization_uuid, started_at, ended_at, next_started_at
from (
  select organization_uuid, started_at, ended_at,
         lead(started_at) over (partition by organization_uuid order by started_at) as next_started_at
  from billing_account_assignments
) a
where next_started_at is not null
  and ended_at is distinct from next_started_at;
```

Expect no rows. Run both queries again after the moves in section 2.

**Creating keeps working for old clients (D3).** Call `POST /api/v1/admin/organizations`
with only `name` and `slug`. It answers 201, and a new account named after the
organization exists.

## 2. Admin (delivery 3)

Rebuild `admin` (and `portal`, because the kit changed).

1. **Organizations → New organization.** Name it "Quickstart Shop" and keep **New
   billing account**. The account's name follows the organization's name. Create it.
   The list shows the new organization with its account in the Billing account column.
2. **New organization** again. Name it "Quickstart Home", choose **Existing billing
   account**, search "Quickstart Shop" and select it. Create it.
3. Open **Billing accounts → Quickstart Shop**:
   - Organizations lists both organizations;
   - History shows "created" and two "joined" entries with your name.
4. Under **Owners**, add the owner user. Set **Organization limit** to 3.
5. On **Organizations**, choose **Change billing account** for a third, existing
   organization and select Quickstart Shop. Its old account is now empty. Delete it
   from **Billing accounts**. Deleting Quickstart Shop is refused while it has
   organizations.
6. Open the moved organization in the portal. Its members, devices and dashboards are
   unchanged (SC-005).

## 3. Portal (delivery 4)

Rebuild `portal`. Sign in as the owner. They are not a member of any Quickstart
organization unless you invited them.

1. The user menu shows **Billing accounts**. A user who owns none sees no such item.
   If the owner belongs to no organization, the landing page points to **Billing
   accounts** instead of telling them to ask for an invitation.
2. The page shows "3 of 3 organizations". Quickstart Shop and Home are listed as "Not
   a member" with no Open link. **New organization** is disabled and names the limit.
3. As the super administrator, raise the limit to 4.
4. As the owner, open the page in a second tab and leave it. In the first tab, choose
   **New organization**, enter "Quickstart Café" and leave the address alone. Create
   it. The portal switches to it and the owner is Organization Admin there: Settings →
   Members lists them with that role (SC-003).
5. In the second tab, which still shows 3 of 4, create another organization. It is
   refused with "This billing account allows 4 organizations. Ask the platform
   operator to raise the limit." After a reload, **New organization** is disabled.
6. Open `/organizations/<Quickstart Home uuid>/home` directly. It is refused, because
   owning the account grants no access (SC-006).
7. As an ordinary member of Quickstart Café, check that `/me` and the organization
   pages carry no `billing_account` field and that the menu has no Billing accounts
   item (FR-019).
