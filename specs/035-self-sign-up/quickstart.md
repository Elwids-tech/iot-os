# Quickstart: Verifying Self Sign-Up

How to prove [spec 035](spec.md) works on the local stack. Routes are in
[contracts/sign-up-api.md](contracts/sign-up-api.md); the push body is in
[contracts/sign-up-push.md](contracts/sign-up-push.md).

## Prerequisites

- The dev stack running with the API family, portal and admin rebuilt from the branch
  (AGENTS.md, `.agents/skills/local-container-verification`), holding
  `.local/stack-rebuild.lock` while rebuilding.
- Mail goes to the local mail catcher (or the `log` mailer: read the link from
  `storage/logs`).
- A super administrator with two-step set up, and push turned on in the portal's
  **My notifications** in Chrome. Push needs the root `.env`'s dev VAPID pair
  (spec 033 quickstart).

## Scenarios

1. **Closed by default.** Open `http://localhost:5173/sign-up`: it says sign-up is
   closed, and the sign-in page has no **Start free** link.
2. **Open it.** In the admin app, **Settings → Sign-up**: switch **Allow sign-up**
   on and save. The page shows push on, email off, free beta on, limit 50, and how many
   push devices you have. The activity log has `sign_up_settings.updated`.
3. **Sign up.** In a private window, open `/sign-up`, fill in a new `@example.com`
   address and an organization name, and submit. *Check your email* appears. The
   beta message is beside the form.
4. **Confirm elsewhere.** Open the link from the mail catcher in another browser. It
   says the organization is ready and asks for sign-in. Within a few seconds the
   private window signs in on its own and opens the new organization's Home with
   **Connect your first device** and the beta message.
5. **What was created.** In the admin app: the organization exists under a new billing
   account named after it, owned by the person, with no plan and a limit of 1; the
   person is its Organization Admin; **Sign-ups** lists the sign-up as *Completed*.
6. **Staff push.** The super administrator's Chrome shows *New sign-up · {org}*;
   clicking it opens the organization in the admin app. No staff email was sent.
7. **Email on.** Switch **Email** on, sign up again: one email per super administrator
   arrives with the person's name and email.
8. **Existing address.** Sign up with the super administrator's own address: the same
   *Check your email* appears, and the email says an account exists. Nothing is
   created; **Sign-ups** shows nothing new.
9. **Limits.** Submit six times from one address within an hour: the sixth is refused
   with when to try again. Set the daily limit to the day's count: the next sign-up
   is paused, and staff get one *Sign-ups paused for today* push.
10. **Bots.** Submit with the hidden `website` field filled (devtools), or within 3
    seconds of loading: refused with a generic message and listed as *Refused*.
11. **Two-step.** In the new organization, turn on **Require two-step sign-in**: the
    person is sent to two-step setup on their next request, as any member.

## Automated checks

- `cd apps/api && php artisan test --compact --filter=SignUp` on PostgreSQL.
- `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/admin lint`, the portal's
  `e2e/sign-up.spec.ts` and the admin's `e2e/sign-up-settings.spec.ts`.
- `pnpm --filter @iot-os/portal test` renders every case in
  `contracts/push/v1/sign-up-push.v1.cases.json`.
- `pnpm --filter @iot-os/docs build` with `features.self_sign_up` true and false.
