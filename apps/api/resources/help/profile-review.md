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
  "revision": 2,
  "summary": "Every saved draft is checked automatically. **Review** shows any issues and what the next version contains or changes.",
  "questions": [
    "What do I need before publishing?",
    "Why is publication blocked?"
  ]
}
---
## Purpose
Every saved draft is checked automatically. **Review** shows any issues and what the next version contains or changes.

## Before you start
Save pending profile edits first. Publication requires the profile publish capability.

## Steps
1. Save your edits. The status under the profile name shows **Checking…**, then **Ready to publish** or the number of issues to fix.
2. Open **Review** to see the issues and where they are. A first version lists the parameters, calculations and alarm templates it will contain. Later versions list the changes since the live version in **Fields** or the read-only **JSON** view.
3. Fix any issues and save. The check runs again.
4. Choose **Publish version** in the profile header and confirm. When you came from adding a device, the button reads **Publish and continue setup** and takes you back with this profile selected.

## Expected result
The profile gains a published revision. Device configuration activation remains a separate task.

## Troubleshooting
Only saved edits are checked and published. If the check didn't finish, choose **Check again** in **Review**. When another editor changed the draft, review concurrent changes and retain the intended values before publishing.

## Related guides
[Read the related guide](/help/device-configuration)
