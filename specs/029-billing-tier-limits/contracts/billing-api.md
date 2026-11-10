# Contract: Billing HTTP API (specs 028 and 029)

All routes are under `/api`. Responses use the existing `{ "data": … }` envelope and
422 validation shape. `php artisan contract:export` writes them to
`contracts/openapi/openapi.json`. Supplements in
`contracts/openapi/supplements/billing.yaml` cover the bodies Scramble cannot infer.
`packages/api-client` changes in the same pull request (constitution IV).

## Shared shapes

```jsonc
// Allowance, as resolved for an account
{
  "kind": "data_points",            // alerts | sms | devices | data_points | retention_days | organizations
  "value": 1000000,                 // null = unlimited; retention: null = platform default
  "source": "plan",                 // override | plan | default
  "note": null                      // the override's note
}

// Usage for one kind in one month
{
  "kind": "data_points",
  "month": "2026-11-01",
  "count": 812345,
  "allowance": 1000000,             // null = unlimited; the allowance now, even for an earlier month
  "left": 187655,                   // null when unlimited or for an earlier month; 0 when over
  "overage": 0,
  "final": false,                   // data points only; alerts, SMS, devices are always current
  "reported_at": "2026-11-07T20:41:00Z", // data points only
  "organizations": [ { "organization_uuid": "…", "name": "…", "count": 400000 } ] // omitted for managers
}

// Devices are a level
{ "kind": "devices", "count": 48, "allowance": 50, "left": 2, "peak_this_month": 49, "over_limit": false }

// Money
{ "amount": 12500, "currency": "EUR", "formatted": "125.00" }  // currency comes from config; example only
```

## Platform administrators

Every route needs `PlatformAdministration.manageOrganizations`. Routes are named
under `admin.` and live in `app/Domain/Billing/routes/api.php`.

### Plans (028 US1, 029 US1 and US6)

| Method and path | Purpose |
| --- | --- |
| `GET /v1/admin/billing-plans?search&archived` | List: name, allowances, price for this and next month, number of accounts, archived |
| `POST /v1/admin/billing-plans` | `{name, description?, allowances: {kind: value\|null}}` |
| `GET /v1/admin/billing-plans/{plan}` | Detail with history |
| `PATCH /v1/admin/billing-plans/{plan}` | `{name?, description?, allowances?, confirm_affected?: int}`. Changing allowances on a plan in use needs `confirm_affected` equal to the current number of accounts (else 409 with that number). A shorter `retention_days` also returns the deletion date and affected organizations in its 409. |
| `PUT /v1/admin/billing-plans/{plan}/prices` | `{base_price, alert_overage_price, data_point_overage_price, data_point_block_size}`, effective from the next month; the response says from when |
| `POST /v1/admin/billing-plans/{plan}/archive`, `/restore` | |
| `DELETE /v1/admin/billing-plans/{plan}` | 409 if it has ever been assigned |

### A billing account's plan, allowances and prices

| Method and path | Purpose |
| --- | --- |
| `GET /v1/admin/billing-accounts/{account}` | Existing (spec 023), now with `plan_assignment` (the plan, `kind`, `started_at`, `trial_ends_at`), `allowances[]`, `usage[]` (this month), `price_overrides[]`, `payment_method`, `past_due_since`, `billing_details` |
| `PUT /v1/admin/billing-accounts/{account}/plan` | `{plan_uuid}`; `null` removes the plan. A shorter retention needs `confirm_retention: true` (else 409 with the date and organizations). |
| `PUT /v1/admin/billing-accounts/{account}/allowances/{kind}` | `{value, note}` override |
| `DELETE /v1/admin/billing-accounts/{account}/allowances/{kind}` | Remove an override |
| `PUT /v1/admin/billing-accounts/{account}/prices/{price}` | `{value\|null, note}`, from next month |
| `PATCH /v1/admin/billing-accounts/{account}/billing-details` | `{billing_address, tax_number, tax_rate_uuid\|null}` |
| `GET /v1/admin/billing-accounts/{account}/usage?month=` | Usage for a month, with organizations |
| `GET /v1/admin/billing-accounts?plan=&usage_at_least=80&trial=active\|ending\|ended_unpaid&past_due=1` | The spec 023 list, with the 028/029 filters added. `usage_at_least` covers this month's alerts, SMS and data points and the current device count. |

Creating an organization (`POST /v1/admin/organizations`) accepts, with
`new_billing_account`, `plan_uuid?` and `trial?: {plan_uuid, ends_at\|null}` (028
FR-010, 029 FR-046).

### Trials (029 US8)

| Method and path | Purpose |
| --- | --- |
| `POST /v1/admin/billing-accounts/{account}/trial` | `{plan_uuid?, ends_at\|null}`; 409 if a trial is open |
| `PATCH /v1/admin/billing-accounts/{account}/trial` | `{ends_at\|null, plan_uuid?}` extend, shorten, change plan |
| `POST /v1/admin/billing-accounts/{account}/trial/end` | Ends now, following the card rule (029 FR-050) |
| `POST /v1/admin/billing-accounts/{account}/trial/convert` | Turns it into a paid assignment of the same plan at once; the rest of the day stays the trial's, so it is charged from the next 00:00 UTC |

### Settings and tax (029 US6)

| Method and path | Purpose |
| --- | --- |
| `GET/PUT /v1/admin/billing/settings` | Operator details, prefixes, `revision` (409 on a stale revision); `currency` and `payments_enabled` are read-only |
| `GET/POST /v1/admin/billing/tax-rates`, `PATCH /v1/admin/billing/tax-rates/{rate}`, `POST …/{rate}/archive` | Named rates in basis points |

### Invoices, credit notes and payments (029 US6 and US7)

| Method and path | Purpose |
| --- | --- |
| `GET /v1/admin/billing/invoices?status=&month=&account=&payment_status=` | Drafts to review, issued, unpaid |
| `GET /v1/admin/billing/invoices/waiting?month=` | Accounts whose usage is not final, with "waiting since" |
| `POST /v1/admin/billing-accounts/{account}/invoices` | `{month, note}`: draft anyway, marked incomplete (029 FR-033) |
| `GET /v1/admin/billing/invoices/{invoice}` | Lines, usage, credit notes, payments |
| `POST /v1/admin/billing/invoices/{invoice}/recalculate` | Drafts only |
| `POST /v1/admin/billing/invoices/{invoice}/adjustments` | `{description, amount, note}`, where a negative amount is a credit; drafts only |
| `DELETE /v1/admin/billing/invoices/{invoice}/adjustments/{line}` | Drafts only |
| `POST /v1/admin/billing/invoices/{invoice}/issue` | Assigns the number, fixes the invoice, charges or emails |
| `POST /v1/admin/billing/invoices/{invoice}/credit-notes` | `{amount, reason}` |
| `POST /v1/admin/billing/invoices/{invoice}/payments` | `{amount, note}`: records a payment made outside the platform |
| `POST /v1/admin/billing/invoices/{invoice}/reconcile` | Asks Stripe for the status of pending payments |
| `GET /v1/admin/billing/invoices/{invoice}.pdf`, `.csv` | Downloads |

## Billing account owners

Each route resolves the account among the signed-in person's own accounts and answers
404 otherwise (spec 023).

| Method and path | Purpose |
| --- | --- |
| `GET /v1/billing-accounts` | Existing, now with `plan` (`uuid`, `name`, `since`, `kind` and `trial_ends_at`), `allowances[]`, this month's `usage[]`, `prices` (this month's, and next month's when different), `payment_method`, and the latest invoice summary. `sms` is omitted when the deployment has no SMS provider. |
| `GET /v1/billing-accounts/{account}/usage?month=` | Usage with organizations |
| `GET /v1/billing-accounts/{account}/invoices` | Issued invoices and credit notes only |
| `GET /v1/billing-accounts/{account}/invoices/{invoice}` (+ `.pdf`, `.csv`) | Issued only; a draft answers 404 |
| `POST /v1/billing-accounts/{account}/invoices/{invoice}/checkout` | `{url}`: a Stripe Checkout session for the amount due; 409 when nothing is owed or a payment is processing, 404 while payments are off |
| `POST /v1/billing-accounts/{account}/payment-method/checkout` | `{url}`: a Checkout session in setup mode |
| `DELETE /v1/billing-accounts/{account}/payment-method` | Detaches the card |

The Checkout success and cancel URLs return to `/billing?account={uuid}`. The portal
reads the result from the account, not from the redirect.

## Organization members

| Method and path | Purpose |
| --- | --- |
| `GET /v1/organizations/{organization}/usage` | Needs `Device.manage`. This organization's devices, data points this month, retention period and source, alerts and SMS this month, and what is left of each limited allowance on the account. No account name, organizations, prices or invoices (029 FR-024, 028 FR-022). `sms` is omitted when the deployment has no SMS provider. |

## Refusals

- A device activation or reactivation at the limit answers 422 on `device`: "Your
  billing account's device limit (50) is reached. Deactivate a device or contact the
  platform operator." The account and its other organizations are not named.
- An owner creating an organization at the limit keeps spec 023's 422, with the limit
  now resolved from the allowance.

## Stripe webhook

`POST /api/stripe/webhook` is Cashier's route, with its signature verified. The
events handled are listed in [stripe-webhooks.md](stripe-webhooks.md).
