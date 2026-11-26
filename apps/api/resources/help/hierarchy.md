---
{
  "slug": "hierarchy",
  "title": "Organize devices in the hierarchy",
  "section": "Hierarchy",
  "contexts": [
    "hierarchy",
    "hierarchy.entity",
    "hierarchy.types"
  ],
  "keywords": [
    "hierarchy",
    "site",
    "location",
    "building",
    "floor",
    "line",
    "area",
    "path",
    "place",
    "move",
    "preset",
    "group",
    "history",
    "moved"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 2,
  "summary": "The hierarchy is a tree of places such as sites, buildings and lines; every device and point gets a path through it.",
  "questions": [
    "Where did Locations go?",
    "How do I place a device in a building or on a line?",
    "Why can't I add this type here?",
    "Where was this device last month?"
  ]
}
---
## Purpose
The hierarchy is your organization's tree of places: sites, buildings, floors, lines, feeders, whatever fits your work. Placing a device in it gives each of its readings a path, such as `RiversidePlant/Packaging/Line2/FillerPumpP201/Temperature`, and lets lists, alerts and dashboards filter by any part of the tree. Sites are the top-level entities of the Site type; their time zone still sets where days and shifts start.

## Before you start
Viewing needs device viewing permission. Building the tree and placing devices needs entity management permission; changing types and their rules needs type management permission.

## Steps
1. Open **Hierarchy** under Fleet. An organization with no places yet can start from a preset, such as manufacturing, buildings or power distribution, which adds types and the rules between them.
2. Choose **New entity** for a top-level place, or open a place and choose **Add inside**. Only the types allowed there are offered, and the path name is suggested from the name.
3. Place a device by choosing its place on the device page, or in **Edit device**. A single reading can sit somewhere else: on the device's **Data** tab, choose **Place this parameter**.
4. Open a place to see its **Points**, the latest value of each, and its **Devices**. Switch between that place alone and everything below it.
5. To move a branch, open it and choose **Move…**. The dialog lists what changes, such as devices changing site or time zone, before anything moves.
6. A place's **History** tab lists its moves, renames and the devices placed there and taken away, with who and when. **What was here** shows what was in that branch at a past time, as the tree was then. On a device's page, **History** beside its place shows where it has been.
7. Under **Types**, change what may sit where, which types hold devices, naming templates such as `Feeder<number>`, and which types group members of another type.

## Expected result
Every device and point in the tree has a path. Filtering devices or alerts by a place includes everything below it, and the branches of places grouped under it.

## Troubleshooting
A type is missing from **Add inside** when the rules do not allow it under that place: change the rules under **Types**. A name refused for its template shows the template and an example. Two readings with the same name at one place clash: rename one when placing it. A place marked **Outside the rules** was created before the rules changed; it keeps working, and new changes to it must follow the rules. Archiving a place unplaces its devices and keeps their data.

## Related guides
[Read the devices guide](/help/devices)
