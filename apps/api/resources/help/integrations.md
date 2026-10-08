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
    "token",
    "API",
    "credential",
    "revoke"
  ],
  "required_capabilities": [
    "devices.view",
    "devices.manage"
  ],
  "revision": 1,
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
You need device viewing and management permissions. Decide the minimum device and read permissions the application needs.

## Steps
1. Open **Integrations** and create an application.
2. Choose its name, allowed devices, and read permissions.
3. Save the application and issue a token. Copy the newly shown token immediately into the receiving application.
4. Use the displayed API base URL and organization/application identifiers.
5. Configure a webhook if the application needs event delivery.
6. Revoke the application when access is no longer needed.

## Expected result
The application can access only its granted devices and abilities. A newly issued secret is shown once; existing secrets cannot be retrieved later.

## Troubleshooting
Changing grants invalidates the current token and disables/cancels webhook delivery. Issue a new token and reconfigure afterward. Revocation is permanent. If another editor changed the application, preserve your draft and review the conflict before choosing **Reload latest state**.

## Related guides
[Read the related guide](/help/integration-webhooks)
