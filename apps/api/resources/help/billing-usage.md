---
{
  "slug": "billing-usage",
  "title": "Check usage and what is left",
  "section": "Organization",
  "contexts": [
    "billing.usage"
  ],
  "keywords": [
    "usage",
    "allowance",
    "limit",
    "plan",
    "billing",
    "data points",
    "devices",
    "retention",
    "overage"
  ],
  "required_capabilities": [
    "devices.manage"
  ],
  "revision": 1,
  "summary": "**Settings → Usage** shows this organization's active devices, data points, alerts and SMS this month, what is left of each on its billing account, and how long telemetry is kept.",
  "questions": [
    "How many data points has my organization used this month?",
    "Why can't I activate another device?",
    "How long is our telemetry kept?"
  ]
}
---
## Purpose
**Settings → Usage** shows this organization's active devices, data points, alerts and SMS this month, what is left of each on its billing account, and how long telemetry is kept.

## Before you start
You need permission to manage devices in this organization. Other members do not see the section. Several organizations can share one billing account, so what is left can shrink because of use elsewhere; the page never names the account or the other organizations.

## Steps
1. Open **Settings** and choose **Usage**.
2. Read each allowance: the number is this organization's use, and the line below it is what is left on the billing account, the overage, or that there is no limit.
3. Check **Data points this month**. The count comes from the runtime's reports every minute, so it reads **Provisional** with the time of the last report until the month is over.
4. Check **Telemetry retention** for how many days of readings are kept and where that period comes from.

## Expected result
Months follow UTC. Active devices count the devices holding a place now. Alerts and data points past an allowance keep working and count as overage; an alert is counted once, however many people it reaches. SMS stops once its allowance is used up. When the device limit is reached, activating another device is refused until one is deactivated or the limit is raised.

## Troubleshooting
If the data point count shows a late last report, the runtime has not reported for a while; readings are still stored and the count catches up. If retention shows a pending reduction, a billing change shortened it: older history is deleted only from the date shown. Ask the people who own your billing account to change the plan or limits.

## Related guides
[Read the related guide](/help/alert-notifications)
