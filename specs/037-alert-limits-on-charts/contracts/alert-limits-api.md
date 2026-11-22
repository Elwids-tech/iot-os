# Contract: Alert limits

**Date**: 2026-11-22 | **Plan**: [../plan.md](../plan.md) | **Fields**: [../data-model.md](../data-model.md)

This is the design of the contract. When it is built, the lasting copies are
`contracts/rules/v2/alert-limits.schema.json` with its fixture, the OpenAPI
description, and `docs/features/automation.md`.

## Request

```http
GET /api/v1/organizations/{organization}/workflows/alert-limits?device[]={uuid}&device[]={uuid}
```

| Parameter | Rule |
| --- | --- |
| `organization` | The organization's UUID. The person must be a member. |
| `device[]` | 1 to 100 device UUIDs. Required. |

Authentication and organization membership are checked as for every organization
route of `/api/v1`. The person needs `Device.view` in the organization.

## Response `200`

```json
{
  "data": [
    {
      "workflow_uuid": "00000001-1111-4111-a111-111111111111",
      "workflow_name": "Pump safety",
      "state": "running",
      "device_uuid": "00000010-1111-4111-a111-111111111111",
      "parameter_uuid": "00000030-1111-4111-a111-111111111111",
      "role": "raise",
      "operator": "gt",
      "value": 25,
      "unit": "C",
      "aggregate": "average",
      "window_seconds": 10,
      "held_seconds": null,
      "combined": true
    }
  ],
  "meta": { "checked_at": "2026-11-22T10:00:00+00:00" }
}
```

- `data` is every limit on the asked devices, in a stable order: device, parameter,
  automation name, value.
- A device with no limits, a device that is not this organization's, and a UUID that
  names nothing all contribute no rows. The response does not say which.
- An organization with no applied automation returns an empty `data`.

## Errors

| Status | When |
| --- | --- |
| `401` | Not signed in. |
| `403` | No `Device.view` in the organization. |
| as today | Not a member, or no such organization: whatever every organization route answers. |
| `422` | `device` missing, not a list, over 100, or not UUIDs. |

## Guarantees

- Read only. Nothing is written, and nothing is asked of the runtime.
- Rows come only from applied deployments (see the States table in the data model).
- A limit that cannot be placed exactly on the parameter's value axis is not returned.
- No row ever names an automation, device or parameter of another organization.

## Golden fixture

`contracts/rules/v2/alert-limits.fixture.json` holds cases of the form
`{ "name", "workflow", "limits" }`, where `workflow` is an `automation-workflow.v2`
graph and `limits` is what the resolver must return for it (without the automation's
name, identifier and state). It must cover at least:

| Case | Expected |
| --- | --- |
| Reading compared directly, each operator | one `raise` limit |
| Average, minimum and maximum window | limit with `aggregate` and `window_seconds` |
| Held for a duration | limit with `held_seconds` |
| Two conditions joined with AND, and with OR | two limits, `combined` true |
| Alert on the `false` branch | operator inverted |
| Hysteresis | a `raise` and a `clear` limit |
| Hysteresis on the `false` branch | no limits |
| Converted unit, same family | value in the binding's unit |
| Conversion whose `from` is not the binding's unit | no limits |
| Arithmetic before the comparison | no limits |
| Comparison of two readings | no limits |
| Count window, sum window | no limits |
| Inverted `eq` | no limits |
| Condition that leads only to a command | no limits |
| Geofence condition | no limits |
| A node type the resolver does not know | no limits |

The PHP resolver is tested on every case. The Go evaluator is run on the direct,
inverted, hysteresis and converted cases with a reading just either side of each
limit, and must raise or clear the alert as the case says.

## Dashboard definition

A time series panel's `config` accepts one more optional key:

```json
{ "alert_limits": false }
```

Absent means on. `true` is accepted and stored as the absent key. Any other panel type
refuses the key with the existing "does not accept these settings" error.

## Alerts list (changed behaviour, same shape)

`GET /api/v1/organizations/{organization}/alerts?device={uuid}` returns an automation's
alert for every device the automation reads. The alert's `devices` and `devices_total`
list those devices. `device_uuid` and `device_name` are unchanged.
