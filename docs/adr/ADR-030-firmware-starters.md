# ADR-030: Firmware Starters and Connection Settings

**Status:** Proposed
**Date:** 2026-11-03
**Relates to:** ADR-029 (amends §3), ADR-005, ADR-013

## Context

[ADR-029](ADR-029-embedded-sdk-and-gateway-kits.md) ships an embedded SDK and lets
people with `Device.manage-connections` download a kit per gateway or direct device that
holds credentials, generated metric tables, the SDK and one board example. That kit was
not built yet when firmware developers asked for more:
- the SDK for other microcontrollers, such as an ESP32;
- before any device is registered;
- from wherever they work: the profile, onboarding or the assistant;
- with instructions that let an AI coding agent collect the hardware facts and write the
  device-specific code ([spec 027](../../specs/027-firmware-starter-kits/spec.md)).

Two facts shape the answer:
- **AI tools read everything.** An AI coding agent sends what it reads to its provider,
  so a kit with a password inside cannot be opened in one safely.
- **The halves come from different places.** The platform knows what a device publishes
  (its profile), but not where each value comes from on the hardware.

## Decision

1. **Firmware is downloaded as a credential-free starter plus separate connection
   settings.**
   - **A starter** is generated from published profile revisions and a target. It holds
     the SDK, generated metric tables, the target's project and an AI brief, and no
     credentials or connection details of any device or gateway.
   - **Connection settings** hold the credentials, broker address, identity and CA for
     one provisioned device or gateway, under ADR-029's rules (`Device.manage-connections`,
     private, not cacheable, throttled, recorded without secrets).
   - **A full kit** is a starter plus settings. ADR-029's kits are full kits.
2. **Starters are for signed-in members of the profile's organization** who may view the
   profile. There is no public or anonymous download: the SDK exists to connect devices
   to the platform.
3. **The assistant may offer starters, never credentials.** It offers a starter as a card
   the person presses. Settings are downloaded through the portal (or spec 021's
   permission-checked kit card) directly by the person. Credentials never appear in a
   conversation, tool result or log.
4. **Targets are built or AI-assisted.**
   - **Built targets** (first: Linux, ESP32 on ESP-IDF, NXP i.MX RT on MCUXpresso) ship
     an example that CI builds from the generated starter.
   - **AI-assisted targets** (other families) ship port templates and porting
     instructions, are labelled as having no tested example, and need no SDK release to
     add.
5. **One instructions file for coding agents.** Every starter carries the AI brief once,
   in `AGENTS.md`. A `CLAUDE.md` imports it, and the README gives a fallback prompt.
   - The brief has the agent interview the developer for what the starter does not say,
     record the answers in a schema-checked device brief in the developer's project
     (never collected by the platform), and write code only from the confirmed brief.
   - It forbids reading the settings.

## Consequences

- Firmware work can start from a profile before hardware is registered, and starters
  can be committed and opened in AI tools without exposing credentials.
- Settings keep ADR-029's exposure: nothing new can reach credentials.
- The platform maintains a target registry, examples per built target, and CI with
  vendor toolchains (ESP-IDF, MCUXpresso). Adding a built target is a reviewed change
  with CI proof.
- The instructions file becomes product surface. A test keeps its paths and API names in
  step with the SDK; how agents follow it is checked on the bench, not in CI.
- Device briefs stay on developers' machines. Uploading them, or turning register maps
  into profile data, needs a later decision.
- ADR-029 §3 still governs who may download credentials; this ADR changes only what a
  download contains and how it is split.
