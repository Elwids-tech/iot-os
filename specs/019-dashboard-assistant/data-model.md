# Data Model: Dashboard Assistant

Two new columns, one new table, and new values in existing JSON columns. No device,
telemetry or runtime data changes.

## Changed tables

### `assistant_conversations`

| Column | Change | Notes |
| --- | --- | --- |
| `dashboard_id` | new, nullable FK to `dashboards`, `nullOnDelete`, indexed | Target dashboard; null for a new-dashboard conversation until **Create dashboard** succeeds |
| `scope` | new value `dashboard` | Existing string column |
| `onboarding_state.target_kind` | new key: `new` or `dashboard` | Set when the conversation is created; changes from `new` to `dashboard` only when **Create dashboard** succeeds; distinguishes "new" from "its dashboard was deleted" |
| `onboarding_state.target` | used for `dashboard` scope | The draft summary sent with the latest message (revision, panels: id, type, title, source pairs) |
| `onboarding_state.questions` / `answers` | reused | Same shape as the profile scope |
| `onboarding_state.options` | new key | `{sources, options: [{rank, type, title, reason, widget}]}` from the latest `offer_options`; replaced by the next one and cleared when a proposal is stored |
| `onboarding_state.unmet` | new key | `{category, title, body, alternative}` from the latest `record_unmet`; cleared by the next run |
| `onboarding_state.alert` | new key | `{text}` from the latest `offer_alert`; cleared by the next run |

Rules:
- `target_kind = dashboard` requires `dashboard_id` at creation; the conversation is
  bound to that dashboard for its life.
- A `target_kind = new` conversation receives `dashboard_id`, and its `target_kind`
  becomes `dashboard`, once, inside the transaction that applies a `dashboard` proposal;
  neither changes after that. From then on it is that dashboard's conversation (FR-004).
- A `dashboard` conversation whose `dashboard_id` became null (dashboard deleted) is
  read-only and answers 410 to messages and decisions.
- Access: creator only, same organization, `Dashboard.create` (new) or the edit ability
  on the dashboard (existing), and `Device.view`; re-checked on every request and run.

### `assistant_proposals`

No new columns. Dashboard proposals use:

| Column | Value |
| --- | --- |
| `section` | `dashboard` (new dashboard) or `dashboard_panels` (panels for an existing dashboard) |
| `status` | `pending` → `applied` / `dismissed` / `superseded` (no `approved` step) |
| `summary` | The model's one-line summary |
| `draft_revision` | The target dashboard's revision when prepared (`dashboard_panels` only) |
| `before` | `dashboard_panels`: the draft summary the proposal was prepared against; `dashboard`: null |
| `changes` | The validated document: `dashboard` → `{name, widgets, layouts, defaults}`; `dashboard_panels` → `{widgets}`; each widget also carries `reason` (≤ 300 characters), kept outside the saved widget |
| `diagnostics` | Server notes per panel: `{widget_id, code, message}`, codes `time_zones_differ`, `devices_left_out`, `split_by_unit`, `split_by_limit` |
| `content_hash` | `sha256` of canonical JSON of `[conversation id, section, draft_revision, changes]` |
| `result` | `dashboard`: `{dashboard_uuid}`; `dashboard_panels`: `{widget_ids}` |

Rules:
- At most 20 widgets per proposal; for `dashboard_panels`, the target's panel count plus
  the proposal's stays at most 100.
- A new proposal supersedes every pending proposal in the conversation.
- `pending` is the only state that can be applied or dismissed; replays of the same
  decision return the stored result.
- Proposals are immutable after creation; only `status` and `result` change.

State transitions:

```text
pending ──approve──▶ applied
pending ──reject───▶ dismissed
pending ──new proposal──▶ superseded
```

### `dashboard_revisions`

| Column | Change | Notes |
| --- | --- | --- |
| `origin` | new, nullable string(16) | `assistant` when the revision was created from an assistant proposal; null otherwise. Reserved for `agent` (spec 004). Returned by the revisions list |

## New table

### `assistant_unmet_requests`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint | |
| `day` | date | UTC day |
| `category` | string(32) | One of the categories below |
| `count` | unsigned integer | Incremented atomically (`insert … on conflict do update`) |
| timestamps | | |

Unique on (`day`, `category`). Pruned after 400 days. No organization, user or text.

Categories: `cross_device_total`, `grouping`, `ranking`, `formula`, `custom_visualization`,
`sharing_or_kiosk`, `other`.

## Value objects (not stored on their own)

### Option

From `PanelSuggestions::suggest`, returned by the `options` tool and offered to the person
with `offer_options`:

| Field | Notes |
| --- | --- |
| `type` | A panel type |
| `reason` | Same text as **Add panel** |
| `rank` | 1-based |
| `incompatible` | For the other types: `{type, reason}` as the **Visualization** picker shows |
| `notes` | `time_zones_differ`, `split_by_unit`, `split_by_limit` |

### Draft summary (`target` for an existing dashboard)

`{revision, panels: [{id, type, title, sources: [{device_uuid, parameter_uuid}]}]}`;
at most 100 panels and `assistant.max_draft_characters`. Context only; never trusted
for authorization.

### Proposed panel (the `preview_dashboard` input per panel)

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | Any of the 12 panel types |
| `title` | yes | ≤ 120 characters; linted (research R11) |
| `description` | no | ≤ 1000 characters; linted |
| `reason` | yes | ≤ 300 characters; linted |
| `sources` | for parameter panels | `[{device_uuid, parameter_uuid, thresholds?, base?}]`; the server fills label, unit, data type, format, display widget, device name, colour and base band as `sourceFor` does |
| `thresholds` | no | `[{value, label, tone}]`, `tone` ∈ `good`, `info`, `warning`, `critical` (the profile state tones), stored as the fixed hex per tone from the shared fixture (research R19) |
| `settings` | per type | `bucket`, `period`, `min`, `max`, `columns`, `devices`, `location_device_uuids`, `geofence_uuid`, `show_trails`, `show_labels`, `trail_window`, `workflow_uuid`, `text` |

Validation order: shape → claims lint → completion from the applied profiles (Controls
need `Device.command`; panels naming a workflow need `Workflow.view`) →
`PanelSuggestions::incompatibility` for each panel → `DashboardDefinition::validateDocument`
→ size limits. The first failure is returned to the model with the panel index and
reason.
