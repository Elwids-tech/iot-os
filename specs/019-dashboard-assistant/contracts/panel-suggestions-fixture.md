# Contract: Panel Suggestion Parity Fixture

`contracts/dashboards/v1/panel-suggestions.fixture.json` pins the PHP
`PanelSuggestions`, `DashboardLayout` and tone mapping to the portal's `suggest.ts`,
`appendLayout` and `bandColor`, and holds the `DashboardClaims` cases (PHP only; the
portal does not lint titles). It is read by
`apps/api/tests/Feature/Domain/Dashboards/PanelSuggestionsContractTest.php` and
`apps/portal/src/dashboards/suggest.test.ts`. Following ADR-015, a rule change edits
the fixture and both implementations in one pull request; a new case is added for every
bug found.

## Shape

```json
{
  "version": 1,
  "palette": ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"],
  "neutral": { "label": "Current", "color": "#64748b" },
  "tones": { "good": "#…", "info": "#…", "warning": "#…", "critical": "#…" },
  "suggestions": [{
    "id": "single_counter",
    "candidates": [{
      "device": { "uuid": "…", "name": "Meter A" },
      "parameter": {
        "uuid": "…", "label": "Energy", "kind": "counter", "data_type": "number",
        "unit": "kWh", "format": null, "display": {}, "validation": {}
      },
      "writable": false
    }],
    "expected": [
      { "type": "consumption", "reason": "Usage per hour, day or month, with meter resets handled." },
      { "type": "status", "reason": "Shows the running total now." },
      { "type": "timeseries", "reason": "Follows the dashboard time range." },
      { "type": "table", "reason": "Lists every value in rows." }
    ],
    "incompatible": { "gauge": null, "state_history": "Needs boolean or enum parameters." },
    "sources": [{ "color": "#3987e5", "base": { "label": "Current", "color": "#64748b" } }]
  }],
  "layouts": [{
    "id": "third_panel_wraps",
    "existing": { "lg": [{ "i": "a", "x": 0, "y": 0, "w": 6, "h": 6 }] },
    "add": ["b", "c"],
    "placement": "available",
    "expected": { "lg": [
      { "i": "a", "x": 0, "y": 0, "w": 6, "h": 6 },
      { "i": "b", "x": 6, "y": 0, "w": 6, "h": 6 },
      { "i": "c", "x": 0, "y": 6, "w": 6, "h": 6 }
    ] }
  }],
  "claims": [{
    "id": "total_across_devices",
    "panel": { "type": "timeseries", "title": "Total energy", "devices": 2, "counter": true },
    "refused": "aggregation"
  }]
}
```

`expected` lists the whole ranked result in order. `incompatible` maps every panel type
to its reason, or null when compatible. The placeholder hex values for `tones` are set in
the implementation pull request.

## Required cases

- Every parameter kind: counter, ranged number, unranged number, `%` without a range,
  boolean, enum, colour, writable state, string.
- A profile visualization hint for each `HINTS` key.
- Several parameters: same unit, mixed units, five counters, mixed counters and
  non-counters, all writable, mixed writable.
- Layouts: an empty dashboard, a half-full row, the bottom placement.
- Claims: each rule in research R11, both refused and allowed.
