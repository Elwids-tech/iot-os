# ADR-049: People Sign Up for Their Own Organization

**Status:** Proposed (spec 035)
**Date:** 2026-11-18
**Amends:** [ADR-026](ADR-026-billing-accounts.md), [ADR-047](ADR-047-progressive-web-app-before-native-apps.md)
**Relates to:** [ADR-008](ADR-008-laravel-sanctum-authentication.md), [ADR-021](ADR-021-developer-docs-only.md),
[ADR-035](ADR-035-plans-and-allowances.md), [ADR-048](ADR-048-two-step-sign-in-and-passkeys.md),
[spec 035](../../specs/035-self-sign-up/spec.md)

## Context

ADR-026 lets two kinds of people create organizations. Platform administrators create
them in the admin app. Billing account owners, whom platform administrators appoint,
create them under their account within its limit. Everyone else joins an organization
only by invitation. So every prospect waits for platform staff before they can connect
a device.

The owner wants prospects to start on their own from the platform's landing site
during the beta, and wants to hear about each sign-up on their phone. ADR-047 limited
push to alerts: "push follows the bell". A sign-up is not an alert, and the people to
tell are platform staff, who may not belong to the organization at all.

## Decision

**Anyone can sign up, when platform staff open sign-up.** The portal's public sign-up
page takes a name, an email, a password and an organization name. Sign-up is closed
on every deployment until a super administrator opens it. The static landing site
only links to the page (ADR-021).

**Nothing exists until the email is confirmed.** The form stores a waiting sign-up and
emails a single-use link. Opening the link creates three things in one transaction:

- the person, with their email confirmed;
- a billing account named after the organization, with the person as its owner;
- the organization under that account, with the person as its Organization Admin.

This is exactly what an administrator and an owner create today (ADR-026), with the
default organization limit of 1 and no plan (ADR-035). Only the browser that submitted
the form is signed in, through the normal sign-in path. The link alone never starts a
session, so two-step rules (ADR-048) apply as for anyone.

**Becoming a billing account owner no longer needs platform staff.** This amends
ADR-026's "platform administrators make users owners". A completed sign-up makes its
person the owner of the account it created. Everything else in ADR-026 stands:

- an account grants no access to data;
- owners create further organizations only within the limit, which only platform
  staff raise.

**Platform notices use the same push registry.** This amends ADR-047's "push follows
the bell":

- Super administrators get a push for each completed sign-up, on the devices they
  registered in the portal like anyone else.
- It uses a separate versioned body, `sign-up-push.v1`. The portal's service worker
  opens such a push in the admin app, and only on the admin app's own origin.
- Alerts still follow the bell, and personal alert levels and organization switches
  do not apply to platform notices.
- Each channel (push, email) is switched for the deployment in the admin app. Push
  starts on and email off.

**Abuse is held back without outside services:**

- limits per network address and per email;
- a server-issued form token with a minimum fill time;
- a hidden field;
- a daily ceiling set by staff;
- the email confirmation itself.

A captcha would need an outside service, which on-premise deployments may not reach.
It waits until abuse is seen.

## Consequences

- Prospects reach their own organization in minutes. Staff follow up from the push,
  the optional email, and the admin app's sign-up list.
- Each sign-up costs a billing account and an organization, but no runtime until the
  organization adds an adapter (ADR-010). The daily ceiling and the limit of 1 bound
  the cost of abuse.
- Pricing is not decided here. The pages say what the deployment's **free beta**
  setting says. When plans are sold to self-signed-up accounts, a later decision sets
  the default plan or trial.
- An on-premise or private deployment that never opens sign-up behaves as before.
- Platform notices on push are now a second kind of push body. A future platform
  notice (support tickets, for example) can reuse this path with its own kind.
