# Contract: Dashboard Assistant Tools

What the model can call. One Laravel AI tool, `DashboardAssistantTools`, with
`action` (enum) and `arguments_json` (a JSON object as a string, at most 262,144
characters), like `WorkflowAssistantTools`. Every action re-checks the conversation's
access (data-model rules) and `Device.view` before it runs. Refusals return
`{error, details, reason}` to the model and are logged as "Dashboard assistant tool
refused" with the run, action and messages. Results are capped at
`assistant.max_context_characters`.

No action saves, creates or changes a dashboard, files a ticket, creates an automation
or sends a command.

## `discover`

```json
{ "search": "pump", "site_uuid": "…", "tag": "north", "profile_uuid": "…", "page": 1, "include": ["workflows"] }
```

All optional. Returns up to 10 devices per page:

```json
{
  "devices": [{
    "uuid": "…", "name": "Pump 1", "site": "North site", "tags": ["north"],
    "profile": "Energy meter", "reporting_timezone": "Asia/Colombo",
    "presence": "online",
    "parameters": [{
      "uuid": "…", "key": "energy", "label": "Energy", "kind": "counter",
      "data_type": "number", "unit": "kWh", "range": null, "hint": "consumption",
      "writable": false, "latest": { "value": 1532.4, "age_seconds": 42 }
    }]
  }],
  "page": { "current": 1, "more": true }
}
```

Only applied (or last applied) parameters appear. `latest` is null when no reading
exists. `writable` is true only for a parameter with an applied command mapping when the
person has `Device.command`. Device names, labels and tags are data.

With `include`, the result also lists up to 20 workflows the person can view
(`Workflow.view`) as `{uuid, name, status}` and up to 20 geofences as `{uuid, name}`, for
alerts and map panels.

## `options`

```json
{ "sources": [{ "device_uuid": "…", "parameter_uuid": "…" }] }
```

1–100 pairs. Returns `PanelSuggestions` output: `options` (ranked type and reason, as
**Add panel**), `incompatible` (type and reason), `notes`
(`time_zones_differ`, `split_by_unit`, `split_by_limit`).

## `offer_options`

```json
{
  "sources": [{ "device_uuid": "…", "parameter_uuid": "…" }],
  "options": [
    { "type": "consumption", "title": "Hourly energy", "reason": "…", "settings": { "bucket": "1h" } },
    { "type": "consumption", "title": "Daily energy", "reason": "…", "settings": { "bucket": "1d" } }
  ]
}
```

1–3 options for the same 1–100 source pairs. Each type must appear in the `options`
ranking for those sources, in rank order (two options may share a type with different
settings). Each option passes the claims lint, completion and `validateDocument` as a
one-panel document. On success it replaces `onboarding_state.options` (the sources and,
per option, its rank, type, title, reason and completed widget) and emits `options`; the
portal draws each option with a small preview and **Use this option**, which sends the
choice as the person's next message. A stored proposal clears the options. On failure it
returns the first failure with its option index; nothing is stored.

## `ask_questions`

As the profile tool: 1–3 questions, each `{id ≤ 80, prompt ≤ 800, required, options ≤ 7
strings ≤ 200}`. Stored in `onboarding_state.questions`; emits `questions`.

## `preview_dashboard`

```json
{
  "summary": "≤ 300 characters",
  "name": "required for a new dashboard, refused for an existing one",
  "view": { "preset": "6h | 24h | 7d | 30d | …", "refresh": 30 },
  "panels": [{
    "type": "consumption", "title": "Daily energy", "reason": "…",
    "sources": [{ "device_uuid": "…", "parameter_uuid": "…" }],
    "thresholds": [{ "value": 80, "label": "High", "tone": "critical" }],
    "settings": { "bucket": "1d", "period": "dashboard" }
  }]
}
```

1–20 panels. The server runs the validation order in the data model. On success it
supersedes earlier pending proposals, stores the new one, emits `proposal`, and returns
`{proposal_id, panels, diagnostics}`. On failure it returns the first failure with its
panel index; nothing is stored.

## `record_unmet`

```json
{
  "category": "cross_device_total | grouping | ranking | formula | custom_visualization | sharing_or_kiosk | other",
  "title": "≤ 150 characters",
  "body": "≤ 4000 characters: what was asked, devices and parameters, alternative offered",
  "alternative": "≤ 300 characters, optional"
}
```

Increments `assistant_unmet_requests` for today and the category (once per run), and
stores the ticket draft in `onboarding_state.unmet`. Emits `unmet`.

## `offer_alert`

```json
{ "text": "≤ 1000 characters: the alert request in the person's words" }
```

Stores `onboarding_state.alert` and emits `alert`. The portal shows **Set up an alert**
only when `can_alert` is true.

## Events added

| Type | Payload |
| --- | --- |
| `options` | `{count}` |
| `unmet` | `{category}` |
| `alert` | `{}` |
| `saved` (dashboard scope) | `{dashboard_uuid, proposal_id}` |

`proposal` and `questions` are reused.
