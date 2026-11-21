# ADR-050: Billing Accounts Carry a Brand and Portal Addresses

**Status:** Proposed (spec 036)
**Date:** 2026-11-20
**Amends:** [ADR-026](ADR-026-billing-accounts.md), [ADR-047](ADR-047-progressive-web-app-before-native-apps.md),
[ADR-048](ADR-048-two-step-sign-in-and-passkeys.md)
**Relates to:** [ADR-008](ADR-008-laravel-sanctum-authentication.md), [ADR-028](ADR-028-activity-log.md),
[ADR-035](ADR-035-plans-and-allowances.md), [ADR-049](ADR-049-self-sign-up.md),
[spec 036](../../specs/036-white-label-custom-domains/spec.md)

## Context

Integrators want to offer the portal to their end customers as their own service: their
name and logo at sign-in, their own web address, and each end customer's logo inside.

The only record that stands for an integrator is the billing account. ADR-026 made it
the payer that groups organizations and "grants no access to data". It has no say over
how the portal looks or where it is served.

A deployment serves the portal on one host and ties several things to its domain:

- The release proxy lists three fixed hosts: `app.`, `admin.` and `api.` under `DOMAIN`
  (`deploy/release/Caddyfile`).
- The session cookie is set for `.DOMAIN`, and the portal calls the API on a different
  host (`deploy/release/compose.yml`, ADR-008). On a customer's own domain that cookie
  would be a third-party cookie, which browsers block.
- Passkeys use one relying party, `DOMAIN` (ADR-048, `config/fortify.php`). A passkey
  works only on its relying party's domain and subdomains.
- The installed app's name and icons are fixed at build time (ADR-047,
  `apps/portal/vite.config.ts`). Push subscriptions belong to one origin.
- Emails and alert links are built from one `FRONTEND_URL` and the application's name.

The portal already loads `runtime-config.js` before it starts, so a per-host answer to
that one request can carry the brand without rebuilding the portal.

## Decision

**A billing account may carry a brand and portal addresses.** This amends ADR-026: the
account still grants no access to data, but it now also says how the portal is
presented to the people of its organizations and where. The brand is a product name, a
logo, a square icon and a support link. An organization may hold its own logo. Colours
are left for a later decision.

**Before sign-in the brand follows the host; after sign-in the logo follows the
organization.** The order inside the portal is the organization's logo, then its
account's, then the platform's.

**An account gets up to two addresses.**

- One name under the deployment's domain (`<name>.DOMAIN`). The existing session
  cookie and passkey relying party already cover it, so sign-in is unchanged.
- One custom domain, claimed by adding a DNS record that points the name at the
  deployment. The account's main address is the custom domain when active.

**On a custom domain the API is served on the same host as the portal**, under the
paths it already uses. The session cookie there is host-only and first-party. The
platform's own hosts keep the present split between `app.` and `api.`.

**Certificates are issued on demand, only for names the control plane knows.** The
proxy asks the API whether a host is an active address before it requests a
certificate or serves anything. Unknown names get no certificate and no portal.

**The host limits who signs in.** On an account's address only members of its
organizations and platform staff get a session, and they reach only that account's
organizations there. The check runs after credentials and any second step. A person
keeps one password and one set of two-step settings on every address.

**Passkeys are per registrable domain.** This amends ADR-048's single relying party:
the relying party is the deployment's domain on the platform's hosts and addresses
under it, and the custom domain itself on a custom domain. A passkey records which. We
do not rely on browsers' related-origin support, which is not available everywhere.

**The installed app and push follow the host.** This amends ADR-047: the manifest's
name and icons are served per host instead of being fixed in the build. Push
subscriptions stay per origin, with the deployment's one key pair; a person turns push
on again at a new domain.

**Outgoing mail and links follow the account.** Mail about an organization carries its
account's brand as the sender's display name and links to the account's main address.
The sending address stays the platform's. Invoices stay under the operator's name.

**Each part is an allowance** (ADR-035): branding, a custom domain, and removing the
"Powered by" line. All are off by default. Changes are recorded in the activity log
(ADR-028). Self sign-up (ADR-049) is not offered on a branded address.

**Unchanged:** the admin app, the public API host, device connections, partner
applications and agent access stay on the platform's hosts.

## Consequences

- An integrator can present the portal as its own in minutes with an address under the
  platform's domain, and on its own domain with one DNS record.
- The portal must run on any host. Everything that assumed one origin has to take it
  from the request: the API base address, cookie scope, the trusted-origin lists for
  sessions and passkeys, and every link the API writes.
- The proxy's host list becomes dynamic. A wrong answer from the "is this host ours"
  check either blocks a customer or lets a stranger's name obtain a certificate, so it
  needs its own tests and a cache with a short life.
- Names under the deployment's domain need a wildcard certificate or the same
  on-demand issuing; the plan chooses.
- A deployment that cannot reach a public certificate authority cannot issue for
  customer domains by itself.
- People who use a passkey on the platform's domain need another on a custom domain,
  and push must be turned on again there. The portal has to say so plainly.
- A person who belongs to organizations under two integrators signs in at each address
  separately. On the platform's own address they still see all of them.
- A released name is held back for 30 days so an old link cannot land on another
  integrator's sign-in page.
- Colours, sending mail from the customer's domain, an address per organization and a
  branded device host are left out and can build on this record.
