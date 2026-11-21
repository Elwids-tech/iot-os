# Feature Specification: White Labeling and Custom Domains

**Feature Branch**: `spec/036-white-label-custom-domains`

**Created**: 2026-11-20

**Status**: Draft

**Input**: The owner asked to brainstorm "custom domains for users" and "white labeling
the application": branding "with the logos of the End Customers", and "some branding of
the Enterprise (our direct customer) at the login screen and loading screens". A colour
palette defined by the customer is wanted too, but "for later".

## Context

The platform's direct customer is often an integrator, here called the **Enterprise**. It
pays for one billing account and runs one organization per **end customer** under it
([spec 023](../023-billing-accounts/spec.md),
[ADR-026](../../docs/adr/ADR-026-billing-accounts.md)). Today every person, whichever
Enterprise or end customer they belong to, opens the same portal address and sees the
platform's own name on the sign-in page, the loading screen, the browser tab, the
installed app and every email. An Enterprise cannot present the portal as its own
service, and an end customer sees nothing of itself in it.

What exists today, and what this feature has to respect:

- **One portal address per deployment.** The portal, the admin app and the API each
  have one fixed host under the deployment's domain. Sign-in, kept sign-in, passkeys,
  the installed app and push alerts are all tied to that domain (specs 033 and 034).
- **Billing accounts group organizations and grant no access** (ADR-026). The account
  is the only record that stands for the Enterprise. Giving it a brand and a portal
  address changes what it is for, so this feature comes with
  [ADR-050](../../docs/adr/ADR-050-brands-and-portal-addresses.md).
- **People can belong to organizations under several billing accounts.** A person's
  account is one account across the deployment, with one password and one set of
  two-step settings.
- **The portal has no logo today.** Its name appears as text, and the installed app's
  name and icons are fixed when the portal is built.
- **Emails and alert links** all point at the one portal address and carry the
  platform's name.
- **Plans and allowances** (ADR-035) already decide what an account may use. Platform
  staff can override them per account.

This feature gives the Enterprise a brand and a portal address of its own, and gives
each end customer its logo inside the portal.

## Clarifications

### Session 2026-11-20

Decided when the spec was drafted. The first two come from the owner's request. The
rest were recommended in the brainstorm and the owner confirmed all six as written the
same day.

- **Two levels of brand** (owner): the Enterprise's brand where the organization is not
  yet known (sign-in, loading), and the end customer's logo inside the portal.
- **Palette later** (owner): customer colours are out of scope here. The brand record
  is where they will go.
- **Who signs in on a branded address** (recommended): only members of that account's
  organizations, and platform staff. The organization switcher there lists only that
  account's organizations (FR-020 to FR-023).
- **One custom domain per Enterprise** (recommended): no domain per end customer for
  now (FR-012).
- **Passkeys are per domain** (recommended): a passkey made on the platform's domain
  does not work on a customer's own domain, so the person adds one there
  (FR-026).
- **"Powered by" line** (recommended): shown by default on branded sign-in pages;
  removing it is an allowance (FR-008).
- **Self sign-up stays off on branded addresses** (recommended, FR-024).
- **Two steps to an own address** (recommended): first a branded address under the
  platform's domain, which needs nothing from the Enterprise's DNS; then the
  Enterprise's own domain (stories 1 and 3).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Enterprise presents the portal as its own (Priority: P1)

A billing account owner opens their billing account page in the portal and chooses
**Branding**. They enter a product name, upload a logo and a square icon, add a support
link, and pick a portal address under the platform's domain, such as
`acme.example.com` on a deployment whose domain is `example.com`. They save. People who
open that address see the Enterprise's name and logo on the loading screen and the
sign-in page, and its name and icon on the browser tab. Nothing of the platform's own
name shows except a small **Powered by** line under the sign-in form.

**Why this priority**: This is the feature's core, and it needs nothing from the
Enterprise's IT department. An Enterprise can demonstrate its own branded portal the
same day.

**Independent Test**: On a local stack, turn branding on for a billing account, set a
brand and a branded address as its owner, open that address in a fresh browser, and
check the loading screen, sign-in page and browser tab show the brand from the first
frame, with the platform's name only in the **Powered by** line. Sign in as a member
and check the session works as on the platform's address.

**Acceptance Scenarios**:

1. **Given** an account allowed to brand, **When** its owner opens the billing account
   page, **Then** a **Branding** section offers a product name, logo, square icon,
   support link and portal address, with a preview of the sign-in page.
2. **Given** an account not allowed to brand, **When** its owner opens the billing
   account page, **Then** the section says branding is not part of their plan and how
   to ask for it, and nothing can be edited.
3. **Given** a saved brand and address, **When** anyone opens the address signed out,
   **Then** the loading screen, sign-in page and browser tab show the Enterprise's
   name, logo and icon, and never the platform's name or logo, apart from the
   **Powered by** line.
4. **Given** a branded address, **When** the page loads on a slow connection, **Then**
   the platform's own name or logo never appears first and then changes.
5. **Given** a member of one of the account's organizations, **When** they sign in on
   the branded address with their usual email, password and second step, **Then** they
   land in their organization exactly as on the platform's address, and a passkey they
   made on the platform's address works here too.
6. **Given** a brand with a support link, **When** a person chooses **Help** or
   **Contact support** on the sign-in page, **Then** it opens the Enterprise's link.
7. **Given** an owner picks an address that is taken or reserved, **When** they save,
   **Then** they are told so and nothing changes.
8. **Given** the platform's own portal address, **When** anyone opens it, **Then** it
   looks and works as it does today.

---

### User Story 2 - An end customer sees its own logo inside the portal (Priority: P1)

An Organization Admin opens **Settings → General** and uploads the organization's
logo. From then on everyone working in that organization sees the logo at the top of
the navigation, next to the organization's name. An organization without a logo shows
its Enterprise's logo, and one whose Enterprise has no brand shows the platform's.

**Why this priority**: The owner's request names end-customer logos first. It stands
alone: it is useful on the platform's own address, with no branded address at all.

**Independent Test**: Upload a logo to one organization, sign in as a member, and check
the navigation shows it. Switch to an organization without one under a branded account
and check the Enterprise's logo shows; switch to one under an unbranded account and
check the platform's shows.

**Acceptance Scenarios**:

1. **Given** an Organization Admin, **When** they upload a logo in the organization's
   settings, **Then** every member sees it at the top of the navigation on their next
   page load, in light and dark appearance.
2. **Given** an organization without a logo under an account with a brand, **When** a
   member opens it, **Then** the Enterprise's logo shows.
3. **Given** an organization without a logo under an account without a brand, **When**
   a member opens it, **Then** the platform's name shows as today.
4. **Given** a person who switches organization, **When** the new organization opens,
   **Then** the logo changes with it.
5. **Given** a member without permission to change the organization, **When** they
   open its settings, **Then** they see the logo but cannot change it.
6. **Given** an Organization Admin removes the logo, **When** members load a page,
   **Then** the fallback shows again.
7. **Given** a file that is too large, not an image, or an image that could carry
   active content, **When** it is uploaded, **Then** it is refused with the reason.

---

### User Story 3 - An Enterprise uses its own domain (Priority: P2)

The owner wants the portal at `portal.example.org`, a name the Enterprise owns. In
**Branding** they choose **Use your own domain** and enter the name. The page shows the
one record to add at their DNS provider and waits. Once the record is found the address
shows as **Active**, the portal answers there over a secure connection with no
certificate for anyone to buy or install, and it becomes the account's main address.

**Why this priority**: It is what "white label" means to most Enterprises, but it
depends on story 1 and on the Enterprise's own DNS, so it follows.

**Independent Test**: On a test deployment, add a domain the tester controls, add the
record shown, and check the address turns **Active** without anyone on the platform
side acting, serves the branded sign-in page securely, and that a member can sign in,
stay signed in across a browser restart, and use every page.

**Acceptance Scenarios**:

1. **Given** an account allowed a custom domain, **When** its owner enters a domain
   name, **Then** the page shows the record to add and the status **Waiting for DNS**.
2. **Given** the record is in place, **When** the platform next checks (within a few
   minutes, or at once when the owner chooses **Check now**), **Then** the status
   becomes **Active** and the address serves the branded portal securely.
3. **Given** an active custom domain, **When** a member signs in there, **Then** every
   portal page, live update and file download works as on the platform's address, and
   **Keep me signed in** survives a browser restart.
4. **Given** an active custom domain, **When** the owner looks at **Branding**,
   **Then** it is marked as the main address and the branded address under the
   platform's domain still works.
5. **Given** a domain that already belongs to another account, or a name under the
   platform's own domain, **When** an owner enters it, **Then** it is refused.
6. **Given** a domain whose record never appears, **When** seven days pass, **Then**
   the request lapses and the owner is told; the name is free to claim again.
7. **Given** an active domain whose DNS record is later removed, **When** the platform
   notices, **Then** the owner and platform staff see **Not reachable** with the date
   it was first seen, and links in emails fall back to the branded address until it
   recovers.
8. **Given** an owner removes the custom domain, **When** they confirm, **Then** the
   address shows only *This address is not in use*, sessions on it end, and the branded address
   becomes the main one again.
9. **Given** a name that nobody has proven control of, **When** anyone points it at the
   platform, **Then** the platform serves nothing there and requests no certificate
   for it.

---

### User Story 4 - Only the Enterprise's people sign in on its address (Priority: P2)

A branded address is the Enterprise's front door. A person who belongs to one of its
organizations signs in and sees only that Enterprise's organizations in the switcher,
even if they also belong to organizations under other accounts. A person with a valid
account who belongs to none of them is turned away. Platform staff can sign in there to
give support.

**Why this priority**: Without it a branded address would show one Enterprise's brand
around another Enterprise's data, which is the opposite of white labeling.

**Independent Test**: With a person who belongs to organizations under two accounts and
a person who belongs only to the other account, sign each in on the first account's
branded address and check what the first sees in the switcher and that the second is
refused after a correct password.

**Acceptance Scenarios**:

1. **Given** a member of organizations under accounts A and B, **When** they sign in on
   A's address, **Then** the switcher lists only A's organizations, and opening a link
   to one of B's organizations there says it is not available at this address.
2. **Given** a person with no membership under account A, **When** they enter correct
   credentials on A's address, **Then** they are told this account cannot sign in at
   this address, and no session starts.
3. **Given** wrong credentials on a branded address, **When** submitted, **Then** the
   answer is the same as on the platform's address and says nothing about membership.
4. **Given** a platform administrator, **When** they sign in on a branded address,
   **Then** they can open that account's organizations as their permissions allow,
   and only those.
5. **Given** a person whose last membership under the account is removed, **When**
   they next load a page on its address, **Then** they are signed out there.
6. **Given** a branded address, **When** anyone opens the sign-up page there, **Then**
   it is not offered, whatever the deployment's sign-up setting.
7. **Given** an invitation to an organization under a branded account, **When** the
   person opens it, **Then** it opens on that account's main address with its brand.

---

### User Story 5 - Emails, alerts and the installed app carry the brand (Priority: P3)

A member of an end customer under a branded account gets an alert email. It comes from
the Enterprise's product name, shows the Enterprise's logo, and its link opens the
alert on the Enterprise's address. When they install the portal on their phone from
that address, the home screen shows the Enterprise's name and icon. Push alerts they
turn on there arrive under that installed app.

**Why this priority**: The brand is not finished while emails and the phone still show
the platform's name, but the portal itself comes first.

**Independent Test**: Under a branded account with an active address, trigger an alert,
an invitation and a password reset, and check each email's sender name, logo and links.
Install the portal from the address on a phone, check the name and icon, turn push on,
and check a push arrives and opens on that address.

**Acceptance Scenarios**:

1. **Given** an email about an organization under a branded account (an alert, an
   invitation, a support ticket update), **When** it is sent, **Then** its sender name,
   logo and footer carry the Enterprise's brand, and every link opens on the account's
   main address.
2. **Given** an email not about one organization (password reset, email confirmation),
   **When** the person asked for it on a branded address, **Then** it carries that
   address's brand and its links return there.
3. **Given** an email about an organization under an unbranded account, **When** it is
   sent, **Then** it is unchanged from today.
4. **Given** a branded address, **When** a person installs the portal from it, **Then**
   the installed app has the Enterprise's product name and icon.
5. **Given** a person who turned push on at the platform's address, **When** they first
   use the Enterprise's own domain, **Then** they are told alerts must be turned on
   again here, and one tap does it.
6. **Given** push turned on at a branded address, **When** an alert fires, **Then** the
   notification opens the alert on that address, and no notification names the
   platform.
7. **Given** invoices and payment emails for the billing account itself, **When** they
   are sent to the account's owners, **Then** they stay under the platform operator's
   name, since the operator is the seller.

---

### User Story 6 - Platform staff control branding and addresses (Priority: P3)

A platform administrator opens a billing account in the admin app. They can allow or
stop branding, a custom domain and removing the **Powered by** line for it; see its
brand, addresses and their status; edit them on the owner's behalf; and suspend an
address at once. A list of all addresses shows which are active, waiting or not
reachable.

**Why this priority**: Staff need the switch before any Enterprise can start, but it is
small, and stories 1 to 5 can be tested with the allowance set directly.

**Independent Test**: As a platform administrator, allow branding for an account, check
its owner can now edit it, suspend its address and check the address stops serving the
portal within a minute, then restore it.

**Acceptance Scenarios**:

1. **Given** a platform administrator, **When** they open a billing account, **Then**
   they see whether branding, a custom domain and removing **Powered by** are allowed,
   and where each allowance comes from (plan or override).
2. **Given** staff suspend an address, **When** anyone opens it, **Then** within a
   minute it shows only *This address is not in use*, with no brand and no sign-in,
   and the owner sees it as suspended with no way to restore it themselves.
3. **Given** staff stop branding for an account, **When** people next open its
   organizations, **Then** the platform's brand shows, its addresses stop serving the
   portal, and the saved brand is kept for when it is allowed again.
4. **Given** any change to a brand, logo or address by an owner, an Organization Admin
   or staff, **When** it is saved, **Then** it appears in the activity log with who,
   what and when.

---

### Edge Cases

- A person signed in on the platform's address opens a link to a branded address: they
  are not signed in there if it is the Enterprise's own domain, and sign in again.
- An organization moves to another billing account: its members lose the old account's
  address for it and find it on the new account's; its own logo moves with it.
- A billing account is deleted or its last organization leaves: its addresses stop
  serving and become free to claim after a waiting period, so an old link cannot land
  on a different Enterprise's sign-in page straight away.
- An owner changes the branded address under the platform's domain: the old name
  redirects to the new one for 30 days, then is released.
- An owner enters a bare domain (`example.org`): it is refused, with a suggestion to
  use a subdomain such as `portal.example.org`.
- A deployment whose operator has not switched portal addresses on: **Branding**
  offers the brand and logos only, and says addresses are not available here.
- A logo with a transparent background on dark appearance: the owner may give a second
  logo for dark backgrounds; without one the first is used on both.
- An Enterprise's product name is very long: it is limited to 40 characters and the
  installed-app short name to 12.
- A person opens an old emailed link to the platform's address for an organization
  under a branded account: it still works there after sign-in.
- The custom domain's secure connection cannot be renewed: staff are alerted before
  it expires, and the owner sees the status.
- Someone enters a domain to squat on it: it stays inactive without the DNS record,
  lapses after seven days, and one account can have only one request open.
- A support ticket, shared dashboard or kiosk link created under a branded account
  opens on the account's main address.
- Device connections, API clients, partner applications and AI agent access keep using
  the platform's addresses and are unaffected.
- The platform's admin app is never branded.

## Requirements *(mandatory)*

### Functional Requirements

**Brand**

- **FR-001**: A billing account MUST be able to hold one brand: a product name, a logo,
  an optional logo for dark backgrounds, a square icon and an optional support link.
- **FR-002**: Billing account owners MUST be able to view and edit their account's
  brand in the portal when the account is allowed to brand; platform administrators
  MUST be able to do so in the admin app for any account.
- **FR-003**: An organization MUST be able to hold its own logo (and an optional one
  for dark backgrounds), editable by people who may change the organization.
- **FR-004**: Inside the portal, the logo shown for the current organization MUST be
  the organization's own, else its billing account's, else the platform's.
- **FR-005**: Before sign-in, the brand shown MUST be that of the address being
  opened: the account's brand on its addresses and the platform's on the platform's.
- **FR-006**: On a branded address the loading screen, sign-in pages (including
  two-step, password reset, invitation and error pages), browser tab title and tab icon
  MUST show the account's brand from the first thing drawn, never the platform's first.
- **FR-007**: Uploaded images MUST be limited in type and size, checked for content
  that could run in a browser, and refused with a reason when they fail.
- **FR-008**: A branded sign-in page MUST show a small **Powered by** line naming the
  platform unless the account is allowed to remove it.
- **FR-009**: The portal MUST NOT name the platform anywhere else on a branded address,
  including help guides, the assistant, empty states and error messages.

**Addresses**

- **FR-010**: An account allowed to brand MUST be able to choose one address under the
  platform's domain. Names MUST be unique, follow hostname rules, and exclude a
  reserved list that covers the platform's own hosts.
- **FR-011**: An account allowed a custom domain MUST be able to claim one domain name
  it controls by adding a DNS record the platform shows, with no other action by
  platform staff. The name MUST be a subdomain such as `portal.example.org`; a bare
  domain such as `example.org` is refused with that explanation.
- **FR-012**: An account MUST have at most one address under the platform's domain and
  one custom domain. A name MUST belong to at most one account.
- **FR-013**: The platform MUST serve the portal securely on an active custom domain
  without the Enterprise supplying or renewing a certificate.
- **FR-014**: The platform MUST NOT serve the portal on, or obtain a certificate for,
  any name that is not an active address of an account.
- **FR-015**: Each address MUST show a status to owners and staff: waiting for DNS,
  active, not reachable, suspended or lapsed, with the time it last changed.
- **FR-016**: The account's **main address** MUST be its custom domain when active,
  else its address under the platform's domain, else the platform's portal address.
- **FR-017**: Within a minute of an address being removed or suspended, it MUST show
  only *This address is not in use*, with no brand, no sign-in and no data, and
  sessions that exist only there MUST end.
- **FR-018**: A released name MUST NOT be claimable by another account for 30 days.
- **FR-019**: Everything a signed-in person can do in the portal on the platform's
  address MUST work on a branded address, including live updates, uploads, downloads,
  kept sign-in and the installed app.

**Sign-in on a branded address**

- **FR-020**: On an account's address, sign-in MUST succeed only for people who belong
  to at least one organization under that account, and for platform staff.
- **FR-021**: On an account's address, a person MUST see and reach only organizations
  under that account, whatever else they belong to.
- **FR-022**: A refusal under FR-020 MUST come only after correct credentials and any
  second step, so it never reveals whether an email has an account.
- **FR-023**: Losing the last membership under an account MUST end the person's
  sessions on that account's addresses.
- **FR-024**: Self sign-up MUST NOT be offered on a branded address.
- **FR-025**: A person's password, two-step settings and recovery codes MUST be the
  same on every address.
- **FR-026**: Passkeys made on the platform's domain MUST work on addresses under it. A
  custom domain MUST let a person add passkeys for that domain, MUST say that passkeys
  from elsewhere do not work there, and MUST list each passkey with the address it
  belongs to.
- **FR-027**: Rules that require two-step sign-in (platform staff, organizations that
  require it) MUST apply on every address.

**What leaves the portal**

- **FR-028**: Emails about one organization MUST carry its billing account's brand
  (sender name, logo, footer) and link to the account's main address.
- **FR-029**: Emails not about one organization MUST carry the brand of the address
  where the person asked for them and link back there.
- **FR-030**: Emails MUST keep the platform's sending address; only the sender's
  display name changes.
- **FR-031**: The portal installed from a branded address MUST carry the account's
  product name and icon.
- **FR-032**: Push alerts turned on at an address MUST open on that address and MUST
  NOT name the platform. A person who had push on elsewhere MUST be told once that it
  must be turned on again at a new domain.
- **FR-033**: Links the platform creates for people (alerts, invitations, tickets,
  shared dashboards) MUST open on the main address of the organization's account.
  Links to the platform's address MUST keep working.
- **FR-034**: Invoices and payment emails to billing account owners MUST stay under the
  platform operator's name.

**Control and record**

- **FR-035**: Branding, a custom domain and removing the **Powered by** line MUST each
  be an allowance that comes from the account's plan or a staff override, all off by
  default.
- **FR-036**: Platform administrators MUST be able to see every address with its
  account and status, and suspend or restore one.
- **FR-037**: When an allowance is withdrawn the saved brand and names MUST be kept,
  unused, and take effect again when it is restored within the 30 days of FR-018.
- **FR-038**: Every change to a brand, organization logo, address or allowance MUST be
  recorded in the activity log.
- **FR-039**: The admin app, device connections, the public API, partner applications
  and AI agent access MUST be unchanged and stay on the platform's addresses.
- **FR-040**: A deployment that brands nothing MUST behave exactly as today.

### Key Entities

- **Brand**: how an Enterprise presents the portal. Belongs to one billing account.
  Product name, logo, dark-background logo, square icon, support link. Colours join it
  later.
- **Portal address**: a host name on which a billing account's branded portal is
  served. Either a name under the platform's domain or a custom domain; a status; when
  it was claimed, proven, last seen reachable and released.
- **Organization logo**: the end customer's own logo, held by the organization.
- **Branding allowances**: whether an account may brand, may use a custom domain, and
  may remove the **Powered by** line; from its plan or a staff override.
- **Passkey**: gains the domain it was made for, shown to its owner.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A billing account owner sets a brand and a branded address, and sees
  their own sign-in page, in under 5 minutes with no help from platform staff.
- **SC-002**: A custom domain goes from entered to serving the branded portal securely
  within 10 minutes of the DNS record being in place, with no action by platform staff.
- **SC-003**: On a branded address, across the loading screen, every sign-in page,
  the browser tab, the installed app, push alerts and every email about that account's
  organizations, the platform's name appears only in the **Powered by** line (and
  nowhere once that is removed).
- **SC-004**: No frame of the platform's own name or logo is visible while a branded
  address loads, on a throttled connection, in 20 of 20 recorded loads.
- **SC-005**: A person who belongs to no organization under an account never obtains a
  session on its addresses, and a person who does never sees an organization outside
  it there, in every tested combination of memberships.
- **SC-006**: Every portal journey in the existing end-to-end suite passes unchanged on
  a branded address under the platform's domain and on a custom domain.
- **SC-007**: A deployment with no brands shows no visible or behavioural difference
  from today.
- **SC-008**: A name nobody has proven control of never serves the portal and never
  causes a certificate request, however many requests arrive for it.

## Assumptions

- "Users" in the request means the Enterprise: the direct customer that pays for a
  billing account. End customers are its organizations.
- An Enterprise can add a DNS record for a domain it owns. Nothing else is asked of
  its IT department.
- The deployment's operator can issue certificates for names under the platform's
  domain and, on demand, for proven customer domains. A private deployment with no
  route to a public certificate authority can use branded addresses only with
  certificates the operator supplies; that case is for the plan to settle.
- Platform staff means super administrators and platform administrators, as today.
- Limits on image type and size, the reserved name list and the 7 and 30 day periods
  are starting values the plan may adjust.
- Help guides already avoid naming the platform (a release check enforces it), so
  FR-009 is mostly a check of the remaining portal copy.

## Out of Scope

- A colour palette or theme per Enterprise or end customer. Planned next; the brand
  record is built to take it.
- Sending email from the Enterprise's own domain.
- A portal address per end-customer organization.
- A branded host for device connections (MQTT) or for the public API.
- Branding the admin app, the developer documentation or the landing site.
- Single sign-on with an Enterprise's identity provider.
- Translating or rewording portal text per Enterprise.
