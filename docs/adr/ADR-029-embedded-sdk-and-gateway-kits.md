# ADR-029: Embedded SDK and Gateway Kits

**Status:** Accepted (built in spec 026); amended by [ADR-030](ADR-030-firmware-starters.md)
**Date:** 2026-11-02
**Relates to:** ADR-005, ADR-019

## Context

Devices reach the platform by publishing Sparkplug B over MQTT with TLS (ADR-005) on
Mosquitto (ADR-019). Direct devices get a connection kit from the portal, but the
platform offers no device-side library, so every microcontroller integrator writes
their own Sparkplug session. Gateways get their credentials only from a server command
(`devices:export-gateway`); the portal deliberately never shows them. A hardware partner
building gateways with hundreds of RS-485 devices asked for a self-contained
connectivity library with the hardware interfaces left open, and for kits they can
download themselves ([spec 026](../../specs/026-embedded-gateway-sdk/spec.md)).

## Decision

1. **The platform ships an embedded SDK.** A portable C99 library in `firmware/sdk/`
   with no dynamic memory. It handles the Sparkplug edge-node session (births, deaths,
   sequence, aliases, rebirth, host state, commands) for a gateway and its downstream
   devices. Network (TLS stream or modem MQTT), clock, storage, logging and locking are
   integrator ports. The SDK encodes Sparkplug with its own streaming codec, pinned to
   the Tahu protobuf by golden fixtures that both the SDK's tests and the Go runtime's
   tests replay. It uses coreMQTT for MQTT over a stream.
2. **The SDK folder is MIT-licensed.** `firmware/sdk/LICENSE` covers that folder only,
   so integrators can build it into closed-source firmware. The rest of the repository's
   licensing is unchanged by this ADR.
3. **Gateway credentials may leave the platform in a kit downloaded from the portal.**
   People with `Device.manage-connections` download a gateway kit containing the
   gateway's credentials, under the rules that already apply to direct-device kits:
   - private and not cacheable;
   - throttled;
   - recorded in the activity log without secrets;
   - only for gateways with platform-issued credentials on a ready connection.

   The server export command remains. Credentials still never appear in public API
   resources or profile artifacts.

## Consequences

- Integrators start from working firmware and a generated configuration instead of the
  Sparkplug specification. The SDK becomes a supported product surface, with its own
  version, changelog and compatibility promise.
- Kit downloads widen who can obtain gateway credentials, from server operators to people
  with `Device.manage-connections`. There is still no gateway credential rotation; adding
  one is follow-up work if kits are shared carelessly.
- The API image carries the SDK source (copied like `contracts/`).
- SDK payloads become a cross-language contract. Runtime changes to Sparkplug handling
  must keep the SDK fixtures passing.
- Board ports beyond the i.MX RT1050 reference (Zephyr, other vendors), modem drivers and
  store-and-forward are future work.
