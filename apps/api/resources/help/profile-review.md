---
{
  "slug": "profile-review",
  "title": "Review and publish a profile",
  "section": "Device profiles",
  "contexts": [
    "device-profiles.review"
  ],
  "keywords": [
    "review",
    "publish",
    "validation",
    "diagnostic",
    "draft",
    "concurrent",
    "revision"
  ],
  "required_capabilities": [
    "profiles.view"
  ],
  "revision": 1,
  "summary": "**Review and publish** validates the saved draft and lets you inspect a revision before publication.",
  "questions": [
    "What do I need before publishing?",
    "Why is publication blocked?"
  ]
}
---
## Purpose
**Review and publish** validates the saved draft and lets you inspect a revision before publication.

## Before you start
Save pending profile edits first. Publication requires the profile publish capability.

## Steps
1. Open **Review and publish**.
2. Validate the saved draft and inspect blocking diagnostics.
3. Review changes in **Fields** or the read-only **JSON** view.
4. Resolve conflicting or invalid changes and validate again.
5. Confirm publication of the reviewed revision.

## Expected result
The profile gains a published revision. Device configuration activation remains a separate task.

## Troubleshooting
Unsaved fields are not necessarily in the reviewed snapshot. When another editor changed the draft, review concurrent changes and retain the intended values before publishing.

## Related guides
[Read the related guide](/help/device-configuration)
