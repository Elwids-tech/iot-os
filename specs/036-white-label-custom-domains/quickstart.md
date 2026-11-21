# Quickstart: Checking White Labeling and Custom Domains

Run against the rebuilt dev stack ([local setup](../../docs/dev/local-setup.md)), in
the browser pane, signed in as the seeded Acme organization admin unless a step says
otherwise. Shapes are in [contracts/](contracts/); states are in
[data-model.md](data-model.md).

## Setup

- A billing account **A** with two organizations (A1, A2) and an owner; a billing
  account **B** with one organization (B1).
- People: **Ann** (member of A1 only), **Bo** (member of B1 only), **Cy** (member of
  A1 and B1), and a super administrator.
- Dev settings for steps 5 onwards: `PORTAL_ADDRESSES=on` and
  `PORTAL_ADDRESSES_DNS_CHECK=off` in the root `.env`, then rebuild the API family and
  `portal`.
- Two small PNGs: a wide logo and a 512×512 icon. One 2 MB PNG and one SVG for the
  refusals.

## Brands and logos (pull request 2)

1. **Allowance.** As the owner of A, open the billing account page: **Branding** says
   it is not part of the plan and nothing can be edited. In the admin app turn
   **Branding** on for A (a switch, not a number). Reload: the panel can be edited.
2. **Brand.** Enter a product name and a support link, upload the logo and the icon.
   The preview shows the sign-in card with them. Upload the 2 MB file and the SVG:
   each is refused with its reason. Check the activity log shows the changes.
3. **Organization logo.** As an admin of A1, open **Settings → General** and upload a
   logo: the sidebar shows it on the next load, in light and dark appearance. As a
   member without `Organization.update`, the panel is read-only.
4. **Fallback.** Switch to A2 (no logo): the sidebar shows A's logo. Switch to B1: it
   shows the organization's name as today. Remove A1's logo: A's logo shows there.
   Check with `curl` that A's owner gets 404 for B's branding, and that A1's admin
   cannot change A2's logo.

## Addresses under the platform's domain (pull request 3)

5. **Claim.** As the owner of A, choose the name `acme` in **Addresses**. Try `admin`
   and a name B already holds: both are refused.
6. **First paint.** Open the address in a fresh browser profile with the network
   throttled: the loading mark, tab title and tab icon are A's from the first frame;
   the platform's name appears only in **Powered by**. Open the platform's address:
   it looks as it did before.
7. **Who gets in.** On A's address: Ann signs in and lands in A1. Cy signs in and the
   switcher lists only A1; a link to B1 says *Not available at this address*. Bo gets
   *This account cannot sign in at this address* after a correct password, and the
   usual wrong-password answer after a wrong one. The super administrator sees A1 and
   A2 only. `/sign-up` is not offered.
8. **Losing access.** While Ann is signed in on A's address, remove her from A1: her
   next page load signs her out there. Turn **Powered by** off for A in the admin app:
   the line is gone.

## Custom domains (pull request 4)

9. **Claim.** With **Custom domain** off for A, **Use your own domain** explains it is
   not part of the plan. Turn it on, enter `example.org`: refused as a bare domain.
   Enter `portal.acme.localhost`: the page shows the CNAME record and **Waiting for
   DNS**; with the dev setting it turns **Active** at the next check or **Check now**.
10. **Same-host session.** Open `http://portal.acme.localhost:5173`. Sign in as Ann.
    In the network panel every API call goes to that host. Close and reopen the
    browser with **Keep me signed in**: still signed in. Open the platform's address
    in the same browser: not signed in there.
11. **Passkeys.** On the custom domain the security page lists Ann's existing passkey
    as belonging to the platform's domain and not usable here. Add one here, sign out,
    and sign in with it. On the platform's address the new one is listed as belonging
    to the custom domain.
12. **States.** With `PORTAL_ADDRESSES_DNS_CHECK=on` and a name with no record: it
    stays **Waiting for DNS**; set its `claimed_at` back 8 days and run the check: it
    lapses. For an active address, force three failed checks: **Not reachable** with a
    date, and the address still serves. Remove the domain as the owner: it shows
    *This address is not in use* and Ann's session there ends.
13. **Real DNS (test deployment).** On a test deployment with the wildcard record and
    `PORTAL_ADDRESSES=on`: claim a name and a real subdomain you control; add the CNAME;
    within 10 minutes the domain is **Active** with a valid certificate and nobody on
    the platform side acted. Point an unclaimed name at the deployment and request it
    twenty times: no certificate is requested (the proxy log shows the refusals) and
    nothing is served. Run the existing portal end-to-end suite against both addresses.

## Mail, links, the installed app and push (pull request 5)

14. **Mail about an organization.** Trigger an alert in A1, invite someone to A1 and
    update a support ticket in A1. In the mail catcher each has A's product name as
    sender, A's logo or name in the header, no platform name, and links to A's main
    address. The same three for B1 are unchanged from today.
15. **Mail without an organization.** Ask for a password reset on A's address: the
    mail carries A's brand and returns there. Ask on the platform's address: unchanged.
    A billing mail to A's owner still carries the platform operator's name.
16. **Installed app.** On A's address, open `/manifest.webmanifest`: A's name and short
    name. Install it in Chrome: A's name and icon. On the platform's address the
    manifest is the built one.
17. **Push.** As Cy, with push on at the platform's address, open A's custom domain: a
    notice says alerts must be turned on again here; one tap does it. Fire an alert in
    A1: the push on that address shows A's icon and opens the alert there. Fire one in
    B1: no push arrives on A's address; the platform's address still gets it.

## Staff control (pull request 6)

18. **List and suspend.** As a platform administrator open **Portal addresses**: both
    of A's addresses with their states. Suspend the name: within a minute it shows
    *This address is not in use*, the owner sees **Suspended** and cannot restore it.
    Restore it: it serves again.
19. **Withdraw.** Turn **Branding** off for A: its organizations show the platform's
    name, both addresses show *This address is not in use*, and the saved brand is
    still there in the admin app. Turn it back on: everything returns.

## Automated

```bash
cd apps/api && php artisan test --compact tests/Feature/Domain/Branding
```

```bash
pnpm --filter @iot-os/portal lint
```

```bash
pnpm --filter @iot-os/admin lint
```

```bash
python3 -m pytest tooling/release/test_release.py
```

The Pest tests must include the isolation cases of the plan's Constitution Check
(principle III) and the unchanged-deployment case (FR-040): with no brands and the
switch off, every changed route answers as on `main`.
