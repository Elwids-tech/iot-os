---
{
  "slug": "geofences",
  "title": "Draw and activate geofences",
  "section": "Geofences",
  "contexts": [
    "geofences",
    "geofences.editor"
  ],
  "keywords": [
    "geofence",
    "boundary",
    "polygon",
    "GPS",
    "location",
    "outside",
    "assign",
    "map",
    "draw"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "Geofences associate a polygon with GPS devices and detect boundary events using reviewed policies.",
  "questions": [
    "How do I draw a boundary?",
    "Why has a device not produced an outside event?"
  ]
}
---
## Purpose
Geofences associate a polygon with GPS devices and detect boundary events using reviewed policies.

## Before you start
Use devices with suitable GPS/location configuration. Saving and activating requires device management and activation permissions.

## Steps
1. Open **Geofences** and choose **New geofence** or an existing boundary.
2. Right-click the map to add a point, drag points to move them, or use **Add point**. Right-click a point to delete it.
3. Choose the GPS devices and set the outside-duration, sample, gap, and uncertainty policy.
4. Review and save the boundary and assignments.
5. Inspect the activation result for each assigned device; use **Retry** for an eligible failed item after checking its diagnostic.

## Expected result
The boundary and assignments become effective after the runtime acknowledges activation. Individual assignments can have different outcomes.

## Troubleshooting
A polygon needs enough valid points and must not intersect itself. Check location quality, sample gaps, uncertainty, and activation before expecting an event. Automation nodes copy selected geofence geometry; later boundary edits do not update that copy.

## Related guides
[Read the related guide](/help/automation-conditions)
