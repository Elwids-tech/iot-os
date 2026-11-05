---
{
  "slug": "devices",
  "title": "Register and monitor devices",
  "section": "Devices",
  "contexts": [
    "devices",
    "devices.overview"
  ],
  "keywords": [
    "device",
    "register",
    "onboard",
    "status",
    "online",
    "offline",
    "last seen",
    "lifecycle",
    "archived",
    "filter",
    "bulk",
    "many devices",
    "gateway health"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 7,
  "summary": "A registered device connects a discovered source to a published profile and an organization-owned configuration.",
  "questions": [
    "How do I register a device?",
    "What does offline mean?",
    "Where are my archived devices?",
    "How do I onboard many devices from one gateway at once?",
    "How do I track a gateway’s own health?",
    "Where do I get firmware and connection settings for a device?"
  ]
}
---
## Purpose
A registered device connects a discovered source to a published profile and an organization-owned configuration.

## Before you start
Viewing requires device viewing permission. Registration and editing require device management permission; activation uses a separate permission.

## Steps
1. Open **Devices** and choose **Register device**.
2. Supply its identity and select a published device profile.
3. Choose the appropriate source when available.
4. Open **Configuration** to map the source values to profile parameters.
5. Review and activate, then inspect **Overview**, **Measurements**, and **History**.

To onboard many sources of one type behind one gateway at once (this needs both device management and activation permission):

1. Open **Connect → Discovery** and filter by the gateway. Search to narrow the sources if needed.
2. Select sources, or choose **Select all N matching** to select every matching source across pages. Sources that already have a device cannot be selected.
3. Choose **Onboard selected**, pick a published profile, and set the device names, for example `Meter {device_id}`. Check the preview and the match summary: sources missing a metric the profile needs are skipped.
4. Choose **Onboard**. The run panel shows each source's progress. Devices become active once the runtime confirms them.
5. If some sources failed, choose **Retry failed**. Skipped sources need their own setup or a different profile.

A run takes at most 500 sources. Running the same selection again creates no second device for any source.

To track a gateway’s own health, such as its uptime, connection and device counts, add the gateway itself as a device:

1. Open **Devices → Add device** and choose **Through a gateway**.
2. Pick the gateway and tick **The gateway itself** instead of entering a device ID.
3. Use the suggested gateway health profile. If the organization has none, choose **Create gateway health profile** (this needs permission to create and publish profiles); it is created and published with the metrics gateways built with the embedded SDK report.
4. Name the device and continue. Once the gateway is connected, review its metrics and activate as usual.

A gateway’s own metrics can be added as one device only.

For firmware written with the platform’s embedded SDK, a device that connects directly has a **Firmware** group in **Device actions** (this needs connection-management permission). **Download settings** gives the private connection settings to unpack into a firmware starter’s `config/` folder. **Download firmware kit** gives a starter for the device’s profile and a chosen microcontroller with the settings already in place. Starters without credentials come from the profile’s **Firmware** tab. [Read the firmware guide](/help/firmware).

While adding a device that connects directly, the connection step offers **I’m writing the firmware**. Choose it, pick the microcontroller or platform, then choose **Download starter** for a starter for the device’s profile. With connection-management permission, **Download firmware kit** gives the starter with this device’s settings in place. **Download setup bundle** works as before.

For a gateway, open it from **Gateways** and choose **Firmware** (or **Firmware** in the gateway’s row menu):

1. Keep the preselected gateway health profile, or choose another. Without a published `gateway-health` profile, the SDK’s default health metrics are used.
2. Check the device types, one published profile for each kind of device the gateway reads, up to 8. With nothing saved yet, the profiles of the devices already behind the gateway are suggested.
3. Choose the microcontroller or platform, then **Download starter**.
4. With connection-management permission, **Download settings** gives the gateway’s private settings and **Download full kit** gives the starter with them in place. Your choices are saved on the gateway for the next person who opens it.

## Expected result
The directory shows one status per device, from its lifecycle, configuration and presence. The device workspace provides applied configuration and latest data.

**Filters** narrows the list by status (such as Online or Offline), lifecycle, profile and site. Archived devices are hidden by default; the list footer says how many, and **Show** (or Lifecycle **All**) includes them.

## Troubleshooting
Presence and lifecycle answer different questions: a registered or active device may currently be offline. Check **Last seen**, its gateway connection, and the applied configuration. Registration does not automatically activate every draft.

## Related guides
[Read the related guide](/help/device-configuration)
