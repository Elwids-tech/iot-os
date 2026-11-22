---
{
  "slug": "dashboards",
  "title": "Build and use dashboards",
  "section": "Dashboards",
  "contexts": [
    "dashboards",
    "dashboards.workspace",
    "dashboards.library",
    "dashboards.panel"
  ],
  "keywords": [
    "dashboard",
    "chart",
    "panel",
    "widget",
    "layout",
    "time range",
    "save",
    "graph",
    "display"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 2,
  "summary": "Dashboards combine device readings, history, location, controls, and workflow information in one view.",
  "questions": [
    "How do I add a chart to a dashboard?",
    "What is the dashed line labelled with an automation on my chart?",
    "Why is my graph empty?"
  ]
}
---
## Purpose
Dashboards combine device readings, history, location, controls, and workflow information in one view.

## Before you start
You need device viewing permission. Creating or changing a saved dashboard requires device management permission.

## Steps
1. Open **Dashboards** and choose a dashboard or create one.
2. Enter edit mode and choose **Add panel**. Select a panel type, then its devices and parameters.
3. Arrange and resize panels. Use **Time range** at the top of the dashboard to choose the period for historical panels.
4. Choose **Save** to keep dashboard changes.
5. Return to viewing mode to monitor data. Use the dashboard library for reusable dashboards and panels.

## Alert limits on charts
A time series panel draws the value at which a running automation raises an alert on the reading it shows, labelled with the automation’s name, for example “Pump safety > 25 °C”. The line comes from the automation, so it moves when the automation is changed and activated, and goes when the automation is turned off. It is separate from the panel’s own **Thresholds**, which only colour the panel.

- The label and the **Alert limits** list under the chart say how the reading is checked: an average, minimum or maximum over a time window, how long the condition must hold, and whether other conditions also have to be met.
- An automation that turns on above one value and off below another draws both, and marks the lower one as the value that clears the alert.
- A limit that cannot be shown exactly on the reading’s own scale is left out, for example when the automation does arithmetic on the reading or compares two readings with each other.
- A limit outside the values on the chart is listed as above or below the chart; the scale is not stretched to reach it.
- A suspended automation is listed as suspended and not checking, with no line.
- At most 8 lines are drawn on one chart; the list names every limit.
- To hide them on one panel, edit the panel and turn off **Show alert limits** under **Display**.

## Expected result
The saved dashboard reopens with its configured panels. Viewing-time changes and saved viewing defaults are different; save defaults when you want them retained.

## Troubleshooting
If a chart shows “Alert limits are unavailable”, the limits could not be loaded; the readings are still current, and the limits return by themselves. An automation’s limit that is missing may be one that cannot be shown on the reading’s own scale, or the automation may not be running.

An empty historical chart may mean the selected time range contains no stored readings. Check the device configuration, parameter, and time range. Unsaved layout or panel changes need **Save**.

## Related guides
[Read the related guide](/help/device-history)
