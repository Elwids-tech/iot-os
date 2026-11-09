# Quickstart: validating the billing module

Run these in the local stack after each implementation pull request that touches the
scenario. Constitution IX: rebuild first, then exercise the running application.

## Prerequisites

- The full stack (`./taskw devices:up`). Rebuild the services a pull request touches
  with the command in `AGENTS.md`. That is `api` and the API-image services for
  Laravel changes, `runtime` for Go changes, and `admin` and `portal` for the apps.
- A super administrator, and two organizations on one billing account (spec 023),
  each with a simulated Sparkplug device (`tooling/` simulators).
- For payments: Stripe **test mode** keys in the ignored `.local/devices/devices.env`
  (`STRIPE_KEY`, `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `BILLING_CURRENCY`). Keys
  never go into git. To forward webhooks to the local API, run the Stripe CLI:
  `stripe listen --forward-to localhost:<api port>/api/stripe/webhook`.
- Mail is caught by the stack's mail catcher.

## 1. Plans and allowances (028 US1–2, 029 US1)

1. Admin → **Plans** → **New plan**. Give it alerts 3, SMS 2, devices 3, data points
   1,000, retention 30 days and organizations 2.
2. Put the billing account on it. The account page lists every allowance with source
   **Plan**. Override devices to 4 with a note: the source shows **Override**, and the
   history shows both changes.
3. Expect: another account on the same plan is unchanged. An account whose limit was
   raised before rollout shows its old organization limit as an override.

## 2. Device limit (029 US2)

1. Override devices back to 3. Activate three devices across the two organizations.
2. Register a fourth and activate it. Expect a refusal naming the limit of 3; the
   device stays registered.
3. Deactivate one device and activate the fourth. Expect success; usage shows 3 of 3.
4. Run a bulk onboarding of 5 devices behind a gateway with one place free. Expect one
   activated device and four items Failed with the limit reason, their devices kept
   registered; once the limit is raised, **Retry failed** activates them.

## 3. Alerts, SMS and data points (028 US3, 029 US3)

1. Trigger four workflow alerts. Expect alerts 4, one of them overage. Each alert is
   still recorded and emailed. An offline alert adds nothing.
2. Run a simulator at 1,200 readings with re-sent duplicates. Within about a minute,
   usage shows exactly the stored readings, each organization's share and 200 of
   overage, and every reading is in history.
3. Stop the `api` container for ten minutes while readings continue, then start it.
   Expect the counts to catch up exactly. During the gap, usage pages show "Last
   reported …".
4. Check the owner's mail: one email at 80% and one at 100% per allowance, and no
   more that month.

## 4. Usage views (028 US4, 029 US5)

1. As the owner: portal → **Billing accounts** shows the plan, each allowance, usage,
   overage and organizations, matching the admin page.
2. As a manager of one organization: **Settings → Usage** and **Settings →
   Notifications** show that organization only, with no account name and no prices.
3. As a member without `Device.manage`: neither page is shown, and the API answers
   403.

## 5. Retention follows the plan (029 US4)

1. Give one organization an override of 90 days. Change the plan to 7 days. The
   confirmation names the other organization and a deletion date 30 days away.
2. Admin **Settings → Retention** shows "7 days from {date}". The owner has an email.
3. Trigger cleanup (restart `runtime`). Expect nothing older than 7 days to be
   deleted.
4. Move the plan back within the grace period. Expect the floor to end unused.

## 6. Invoices (029 US6)

1. Admin → **Billing settings**: enter the operator's details and a tax rate, and give
   the account that rate. Set plan prices; they apply from next month.
2. To see a month in progress, draft it with **Draft anyway**. The draft is marked
   incomplete and is a preview: it cannot be issued until the month ends (409, and
   **Issue** is disabled). Check the prorated base price, the overage lines, the tax and
   the total. To issue in a test, draft an ended month whose usage is final, or move the
   clock (`billing:draft-invoices --now=`).
3. Add a credit adjustment and issue. Expect the next invoice number, no further
   edits, and one email to the billing contact and each owner. The owner can download
   the PDF and CSV in the portal. A member sees nothing.
4. Issue a credit note larger than the amount due. Expect the excess on the next
   draft as "Credit from CN-…".

## 7. Payments (029 US7)

1. As the owner, **Add card** opens Stripe's page. Use the test card that always
   succeeds. The portal shows the brand and last four digits only.
2. Issue an invoice. Expect one charge, the invoice marked paid, and a receipt.
3. Switch to the test card that attaches but declines charges, and issue another
   invoice. Expect the invoice failed and an email with a pay link. On the due date
   (use `php artisan billing:payment-reminders --now=<date>`), expect a retry and a
   reminder, and after it the account flagged past due. Every device, alert and
   dashboard keeps working.
4. Pay from the link on Stripe's page. Expect the invoice paid. Run `stripe events
   resend` for the same events: nothing changes.
5. Remove the Stripe keys and rebuild. Expect no card form, and administrators record
   payments by hand.

## 8. Trials (029 US8)

1. Start a 30-day trial on a plan, and an open-ended trial on another account. Check
   the portal banner and the admin filters.
2. Shorten the first trial so it ends today, and run `php artisan billing:end-trials
   --now=<tomorrow>`. With a test card saved, the account is charged from that day
   on. Without one, it stays uncharged and is flagged "trial ended, no payment
   method"; adding a card then charges from the next day.
3. Draft the month's invoice. Expect the trial days at 0 and no overage charge for
   them.

## Automated checks

```bash
cd apps/api && php artisan test --compact --filter=Billing
```

```bash
cd services/runtime && DEVICE_TEST_DATABASE_URL=… go test -count=1 -p 1 ./internal/storage/...
```

```bash
python3 tooling/verify-devices-contracts.py
```

```bash
pnpm --filter @iot-os/admin lint && pnpm --filter @iot-os/portal lint
```
