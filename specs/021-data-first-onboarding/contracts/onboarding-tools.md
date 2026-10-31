# Onboarding Assistant Tools (changed)

The one `onboarding` tool keeps `{action, arguments_json}`. Every call re-checks the
run, the conversation's access and the action's permission. Results are capped at
`assistant.max_context_characters`. Spec 020's credential rule (FR-107) and its
Fetch now limits are unchanged.

## The conversation

- **Binding**: the conversation is bound to the setup, and to the setup's source once
  saved ([research R17](../research.md#r17-one-conversation-per-setup-and-continuing-after-each-card)).
- **Run context**: every run's context holds:
  - the setup's derived steps and the step reached;
  - the connector definition's reasons and assistant actions;
  - the open and applied cards;
  - the facts already known: answers, attachments, a captured input summary (at most
    10 samples, 8 KiB each, redacted) and the latest Fetch now result (redacted).
- **Continuing**: applying or dismissing a card adds an event message such as
  "Applied: Use this mapping" or "Dismissed: Use the adapter …". The server then
  queues a run that continues (FR-130).

## Actions

| Action | Arguments | Result | Needs |
| --- | --- | --- | --- |
| `find` | `{kind: sources\|profiles, query?, connector?, settings?}` | Sources with match facts `{uuid, name, connector, device_type, settings_match: same\|different\|unknown, devices}`, or published profiles with readings | `Device.view` |
| `ask_questions` | 1–3 questions `{id, prompt, required, options ≤ 7}` | Shown in the conversation. Optional questions never block **Continue**. A question whose `id` was answered in this conversation is refused | — |
| `recommend_path` | `{connector, reason}` | A `connector` card: **Use this path** sets the setup's connector | — |
| `suggest` | `{card, step, fields, summary, evidence}` | An immutable `step` proposal shown as an action card and as suggested values in the step's form (cards below) | `Device.view`; the person applying it needs the step's permission |
| `status` | `{}` | Setup steps, capture state and reasons, open cards, rollout | `Device.view` |
| `samples` | `{limit ≤ 10}` | Captured input for every connector and the pasted samples (excerpts ≤ 8 KiB) | `Device.view` |
| `fetch_now` | `{}` | Redacted Fetch now result; its records are also stored as captured input | bound polling source, `Device.manage-connections`, shared limit |
| `test_decoder` | `{code?, mapping?, fixtures?: [≤ 10], inputs?: fixtures\|samples}` | The manager's test result per sample, with decoded values. Inline `fixtures` come from pasted or captured samples. Nothing is recorded | bound source, or a setup with a device type |
| `explain` | `{}` | Current capture reasons with their catalogue text and redacted evidence | `Device.view` |
| `propose_adapter` | `{mode: reuse, adapter_uuid}` or `{mode: create, …}` | Kept for Manage. `reuse` is refused unless `find` reported the same device type and `settings_match: same` | as spec 020 |
| `read_source` | `{source_id}` | As today | — |

Removed: `next_step`. Every step now ends in a card, and **Start collecting** is a
`start` card.

## Cards (`suggest.card`)

| Card | Step | `fields` from the model | The person's control | Result shown in the card |
| --- | --- | --- | --- | --- |
| `connector` | start | `connector` | **Use this path** | The Connect form for that connector |
| `settings` | connect | Non-secret settings (`source-settings.v1`) | **Use these settings** | Saved, with the connection check |
| `credentials` | connect | The names of the secret fields needed, never values | Password fields in the card, then **Save** | "API key saved", never the value |
| `secret` | connect | `{label}` | **Create secret** | The ingest URL, and the secret shown once in the card |
| `kit` | connect | `{label}` | **Create connection kit** | The download, and "Waiting for the device" |
| `mapping` | readings | `field-mapping.v1` | **Use this mapping** | Each sample's decoded values with units, then saved |
| `code` | readings | `code`, `fixtures` | **Use this decoder** | Each sample's decoded values (code behind **Show code**), then saved |
| `fixtures` | readings | `fixtures` (from pasted or captured samples) | **Use as test samples** | Saved fixtures |
| `device_type` | readings | `{reuse: {artifact_uuid}}` or `{draft: {name, readings}}`; `evidence` may cite the person's message (origin `stated`) | **Use this device type** or **Create device type** | Matched, missing and extra readings, or the draft's readings |
| `native_device` | connect | `{connector, name, artifact_uuid}` | **Create device** | The connection kit offer |
| `native_matches` | readings | `{matches: [{parameter, metric}]}` | **Use these matches** | Matches with the latest values |
| `start` | collect | `{serials: [{source_device_id, name}]}` | **Start collecting**, after the summary | Rollout progress, then first readings |
| `activate` | collect | `{serials}` | **Activate** the checked serials | Each device's first stored reading |

- **Validation**: `fields` are checked with the step's save rules when proposed and
  again when applied. Any secret value in `fields` refuses the proposal.
- **Staleness**: a card whose `draft_revision` is older than the saved draft is
  `out_of_date`. The person's control is disabled, and the assistant is told.
- **Who presses**: the person, in the conversation or the step's form. The press calls
  the step's own endpoint with `suggestion: {uuid, content_hash}`
  ([API](api.md#setups-new)). No tool can apply a card, start a rollout, create a
  secret or activate.

## Instructions

The agent's instructions:

- name the four steps and the connector list from the definitions;
- require one card per step and continuing after each applied card;
- forbid re-asking known facts, and reuse without a match;
- say that secrets are typed or created only in cards;
- say that the assistant never presses a card's control or runs Start collecting,
  Apply changes or any step of them.
