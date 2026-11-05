---
{
  "slug": "firmware",
  "title": "Get firmware for a device profile",
  "section": "Device profiles",
  "contexts": [
    "device-profiles.firmware"
  ],
  "keywords": [
    "firmware",
    "SDK",
    "embedded",
    "starter",
    "microcontroller",
    "ESP32",
    "STM32",
    "NXP",
    "FreeRTOS",
    "Sparkplug",
    "MQTT",
    "gateway",
    "Modbus",
    "connection settings",
    "firmware kit",
    "coding agent"
  ],
  "required_capabilities": [
    "profiles.view"
  ],
  "revision": 2,
  "summary": "The Firmware tab gives a firmware starter for a published profile: the embedded SDK, the profile’s metrics and a project for your microcontroller, with no credentials.",
  "questions": [
    "How do I get the embedded SDK for my microcontroller?",
    "Which microcontrollers have a firmware starter?",
    "How do I write the firmware with an AI coding agent?",
    "Where do I get a device’s connection settings?"
  ]
}
---
## Purpose
The **Firmware** tab of a published device profile gives a firmware starter. A starter holds the platform’s embedded SDK, a portable C library that publishes over MQTT with TLS using Sparkplug B, tables generated from this profile’s metrics, a project for the microcontroller or platform you choose, and instructions for an AI coding agent. The SDK handles the connection, Sparkplug messages and commands; your code reads the hardware. A starter holds no credentials, so it is safe to commit to a repository and to give to an AI tool.

## Before you start
Publish the profile first: starters are built from a published revision. Downloading a starter needs profile viewing permission. A device’s connection settings need connection-management permission.

## Steps
1. Open **Device profiles**, select the profile and open **Firmware**.
2. In **Microcontroller or platform**, choose your target. **ESP32 (ESP-IDF)** and **Linux or macOS** are built targets: each has a tested project that is compiled on every change. **STM32**, **Raspberry Pi Pico**, **Nordic nRF** and **Other microcontroller** are AI-assisted: they come with port templates and notes, and your coding agent writes the port for your board before the field code.
3. In **How the device connects**, choose **Connects directly** when the device has its own network connection, or **Behind a gateway** when a gateway reads devices of this profile, for example over Modbus RS-485, and publishes them with its own health.
4. Read **Check before building**, then choose **Download starter**.
5. Unzip the starter and read its `README.md`. To write the device code with an AI coding agent, such as Claude Code, Codex, Cursor or GitHub Copilot, open the folder in the agent and send the prompt under **Start with AI**. The agent asks about your hardware and where each value comes from, saves the answers in a device brief, and asks you to confirm them before it writes code.
6. For a device that connects directly, open the device and choose **Device actions**, then **Firmware**, then **Download settings**, and unpack the archive into the starter folder: the settings go into `config/`. **Download firmware kit** gives the starter and the settings in one archive.
7. Build and flash with the commands in the README.

## Expected result
With its settings in `config/`, the firmware connects, announces this profile’s metrics and sends readings, and the device shows as online with current measurements.

## Troubleshooting
**Download starter** stays unavailable until the profile has a published revision. Without settings in `config/`, the program says where to get them and stops before connecting. `config/` holds credentials: `.gitignore` keeps it out of version control, and it must not be shared or given to an AI tool. A gateway’s starter, settings and full kit also come from **Firmware** on the gateway’s page, and a device’s starter from **I’m writing the firmware** while adding it. When the assistant is on, ask it for firmware for a profile: it shows a card that downloads the same starter. When the profile gets a new revision, download a new starter for the same target and follow **Updating** in its README: your code, the device brief and the settings stay as they are. To check the platform side without hardware, use the desktop simulator described in the README.

## Related guides
[Read the related guide](/help/profile-review)
