# Incoming conversions and calculated outputs

An incoming conversion normalizes one received measurement before storage. A calculation creates an additional derived parameter from stored values. Neither operation runs until a published profile is activated on a device.

## Receive watts, store kilowatts

1. Add a **Measurement**, numeric type, with the stored unit **kW**.
2. In **Incoming value conversion**, choose **Scale and offset**. The **Use watts → kilowatts** preset sets the incoming unit to W, multiplier to 0.001, offset to 0, and stored unit to kW.
3. Test a sample of 1000. The form shows `Received: 1000 W → Stored: 1 kW`; **Validate converted sample** also checks the stored type and validation rule.
4. Save, review, and publish the profile.
5. Map the source metric in the device configuration. **Use profile default** inherits from the selected published revision. **Custom conversion** replaces that default. **No conversion** passes the incoming value through; the stored unit is still the profile's unit.
6. Save and validate the device configuration, review captured source samples, then activate. Measurements and history contain the converted value, not a second raw parameter.

Changing only a unit label never converts a value. A conversion change applies to future readings after activation; old readings are not recalculated. History separates configuration revisions and units. Existing protocol diagnostics can still contain raw source data.

## Create another calculated value

**Calculations → Add calculation** defaults to **Create new output**. Enter the label, stable key, numeric type, unit, and optional group; choose existing inputs and aliases; build and test the formula. Saving creates the output and formula in one transaction and advances the draft revision once. Cancel, invalid formulas, duplicate keys, cross-profile inputs, self-references, cycles, and revision conflicts cannot leave a partial output.

**Use existing derived parameter** selects an output without a formula. Existing calculations retain their editor and advanced JSON. Calculations consume stored values after incoming conversion: a doubled power formula receives `1 kW` and produces `2 kW` when the source sent `1000 W`.

## Contract and runtime

New artifacts use `device-profile.v2`; new configurations use `device-configuration.v2`. Version 1 artifacts and configurations remain supported and immutable. The runtime must be upgraded before version 2 is emitted; it rejects unsupported versions instead of silently ignoring conversions.

Profile parameters have nullable `ingress_conversion`:

```json
{"source_unit":"W","multiplier":0.001,"offset":0}
```

Device drafts select `conversion_mode` (`profile`, `custom`, `none`). Only custom drafts supply `ingress_conversion`. Activation resolves the effective settings from the pinned published artifact and stores both the mode and resolved settings in the immutable configuration. Historical rollback uses the recorded settings. Configuration history displays the equations and their origins.

Only reported, read-only numeric measurements and counters support conversions. Multipliers must be finite and nonzero; offsets must be finite. Monotonic counters require a positive multiplier. Fractional integer outputs and non-finite results are invalid, without rounding. Runtime preview and ingestion use the same evaluator. Input quality failures and conversion errors mark readings invalid, propagate to dependent calculations, and preserve the existing last-valid-value behavior; an unconverted value is never substituted as a valid result. Activation resets cached inputs and counter baselines.

The profile API adds `POST /api/v1/organizations/{organization}/device-profiles/{profile}/calculations`. It accepts existing calculation fields, `draft_revision`, and `output` with `key`, `label`, `data_type`, optional `unit`, and optional `parameter_group_uuid`. Existing parameter calculation update routes remain available. The profile preview endpoint also accepts `kind: conversion` and optional calculation `output_data_type`.

## Assistant and verification

The assistant distinguishes converting a measurement from creating another value. It asks for units and the conversion rule, identifies assumptions, and offers samples, expected ranges, and calibration information as optional. Parameter proposals include incoming conversion settings. A calculation proposal can use `uuid: null` and include `values.output` alongside its expression and inputs. The review contains editable fields, a before/after conversion example, exact JSON, validation, evidence, and explicit approval. Publication and device activation remain manual. Device overrides are configured in the device UI; no external MCP endpoint is introduced.

Shared numeric fixtures live in `contracts/devices/v2/conversions.fixture.json` and run in PHP and Go tests. API tests cover field preservation, capability changes, atomic saves, revision conflicts, device modes, and assistant proposal replay. Runtime tests cover conversion ordering, dependent calculations, invalid source values, incompatible configurations, and version 1 compatibility.

### Local verification — 8 September 2026

- 101 API tests / 1,021 assertions passed; all Go packages and 10 portal tests passed. Workspace TypeScript checks and the five executable Devices schema fixtures passed.
- Rebuilt API, assistant worker, runtime, portal, and administration containers; all are running and the API health check passes.
- In the served UI, created **Conversion QA Power Meter** and its output/formula in one save. The form and runtime preview both converted 1000 W to 1 kW. Custom conversion produced 11 kW (and 22 kW derived); bypass produced 1000 (and 2000 derived).
- An isolated Sparkplug simulator reported 1000 W. Activation stored 1 kW and 2 kW derived. A second configuration stored 2 kW and 4 kW derived; rollback restored 1 kW and 2 kW. History retained separate configurations and the recorded equations.
- Desktop and 390 × 844 mobile conversion, calculation, and assistant review layouts were inspected. Confirmed keyboard navigation, exact read-only proposal JSON, edited-proposal revalidation, explicit approval, and immediate profile refresh without overwriting unsaved forms.
- Live assistant testing exposed an incorrect output envelope. Exact schema examples and actionable validation errors corrected it. Combined output/formula approval and conversion review succeeded. Estimated live testing cost for the QA conversation: **$0.059214**; no runs remain active.
- The labelled QA profile, conversation, gateway, and device/history remain for inspection. The QA profile has unpublished assistant changes after published revision 1. Its device is deactivated and the isolated simulator stopped. Existing device profiles, simulators, volumes, and the user's browser edits were preserved. This is local verification, not a production deployment.
