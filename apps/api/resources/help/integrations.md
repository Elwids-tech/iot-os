---
{
  "slug": "integrations",
  "title": "Connect an external application",
  "section": "Integrations",
  "contexts": [
    "integrations",
    "integrations.application"
  ],
  "keywords": [
    "integration",
    "application",
    "permission",
    "grant",
    "site",
    "place",
    "hierarchy",
    "token",
    "API",
    "credential",
    "revoke"
  ],
  "required_capabilities": [
    "devices.view",
    "devices.manage"
  ],
  "revision": 3,
  "summary": "**Integrations** manages organization-owned applications with scoped device access, tokens, and webhook delivery.",
  "questions": [
    "How do I give an application API access?",
    "Why did my token stop working?"
  ]
}
---
## Purpose
**Integrations** manages organization-owned applications with scoped device access, tokens, and webhook delivery.

## Before you start
You need device viewing and management permissions. Decide the minimum read permissions the application needs, and whether it should see a fixed list of devices or whole places in the hierarchy.

## Steps
1. Open **Integrations** and create an application.
2. Choose its name and read permissions, then **Grant access by** either **Devices** (up to 100 named devices) or **Places** (up to 50 places of any kind: sites, areas, lines, feeders). A place grant covers every device placed anywhere below those places, including devices added later; a device that is not placed is never covered. Select **Hierarchy** as a permission when the application should read the places it can see and each device's points with their paths.
3. Save the application and issue a token. Copy the newly shown token immediately into the receiving application.
4. Use the displayed API base URL and organization/application identifiers.
5. Configure a webhook if the application needs event delivery.
6. Revoke the application when access is no longer needed.

## Expected result
The application can access only its granted devices and abilities. A device, or a whole branch, moved out of a granted place stops being visible at its next request. A newly issued secret is shown once; existing secrets cannot be retrieved later.

## Troubleshooting
Changing grants, including archiving a granted place or deleting a granted site, invalidates the current token and disables/cancels webhook delivery. Issue a new token and reconfigure afterward. An application whose places were all archived reads nothing until a place is granted again. Revocation is permanent. If another editor changed the application, preserve your draft and review the conflict before choosing **Reload latest state**.

## Related guides
[Read the related guide](/help/integration-webhooks)
