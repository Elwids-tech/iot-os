---
{
  "slug": "custom-domain",
  "title": "Use your own domain",
  "section": "Billing account",
  "contexts": [
    "billing.branding"
  ],
  "keywords": [
    "custom domain",
    "own domain",
    "domain",
    "subdomain",
    "dns",
    "cname",
    "record",
    "certificate",
    "https",
    "waiting for dns",
    "not reachable",
    "lapsed",
    "passkey",
    "alerts on a new domain"
  ],
  "required_capabilities": [],
  "revision": 1,
  "summary": "Serve the portal on a subdomain of your own, such as portal.example.org. You add one CNAME record at your DNS provider; the address turns active when it is found, and its certificate is issued and renewed for you.",
  "questions": [
    "How do I use my own domain for the portal?",
    "Which DNS record do I add?",
    "Why does my domain say Waiting for DNS?",
    "Why does my domain say Not reachable?",
    "Why doesn't my passkey work on my domain?"
  ]
}
---
## Purpose
Your own domain puts the portal on an address that is entirely yours, such as `portal.example.org`. You prove the domain is yours with one DNS record; nobody on the platform side has to act.

## Before you start
You need to own the billing account, its plan must include a custom domain, and the brand needs a product name. You need to be able to add a DNS record for the domain. Choose a subdomain: a bare domain such as `example.org` cannot be used.

## Steps
1. **Open the billing account.** Open your user menu, choose **Billing accounts**, and find **Use your own domain** under **Addresses**.
2. **Enter the domain.** Type the subdomain, for example `portal.example.org`, and select **Add domain**.
3. **Add the record.** The page shows one record: type **CNAME**, a name (your subdomain) and a value. Copy both into your DNS provider exactly as shown. If your provider offers a proxy for the record, turn it off.
4. **Wait, or check now.** The status reads **Waiting for DNS**. The record is looked for every few minutes; **Check now** looks at once, at most once a minute. DNS changes can take from minutes to a few hours to spread.
5. **Open your domain.** When the status turns **Active**, the portal opens there over HTTPS with your brand. It becomes your **Main address**: links in emails and alerts lead there. Your address under the platform's domain keeps working.
6. **Remove it.** Select **Remove** and confirm. The portal stops opening there within a minute and people signed in there are signed out of it. Adding the domain again later gives a new record.

## Expected result
Your people open the portal at your domain and sign in as usual, with the same password and two-step codes as anywhere else. **Keep me signed in** works there for 30 days.

## Troubleshooting
- **It stays on Waiting for DNS.** Check the record's type, name and value against the page, and that no other record exists for the same name. A request whose record is not found within 7 days lapses; add the domain again to get a new record.
- **The request lapsed.** The record was not found in time. Add the domain again and use the new value: the old one no longer works.
- **Not reachable.** The record was there and has gone missing; the page says since when. The portal still opens at your domain for now, and links in emails use your other address until the record is back.
- **The domain is already in use.** Another billing account uses it or has asked for it, or used it in the last 30 days. Contact the platform operator if it is yours.
- **A passkey does not work on your domain.** Passkeys belong to the address they were made on. Sign in with your password, open **Security** from your user menu, and add a passkey there. The list shows where each passkey works.
- **You cannot finish signing in with a passkey.** If two-step sign-in is required for you and your only second step is a passkey from another address, sign in where you made it and set up an authenticator app, then sign in on your domain.
- **Alerts on your phone.** A browser allows notifications for each address separately. Turn alerts on again at your domain.
- **Suspended.** The platform operator stopped the domain. It cannot be checked or removed until they restore it.

## Related guides
[Show your own brand and address](/help/branding) · [Sign in with two steps](/help/two-step-sign-in) · [Use the portal on your phone](/help/phone-app)
