# Onboarding Assistant Tools

One tool, `onboarding`, with `{action, arguments_json}` like the other assistant
tools; every call re-checks the run, the conversation's access and the action's
permission. Results are capped at `assistant.max_context_characters`. Profile drafting
uses the existing profile tools (`ProfileAssistantTools`, `ApplyProfileSection`) on
the conversation's profile.

| Action | Arguments | Result | Needs |
| --- | --- | --- | --- |
| `find` | `{kind: adapters\|profiles, query?}` | ≤ 20 adapters `{uuid, name, source_type, profile, status, devices}` or published profiles `{uuid, artifact_uuid, name, revision, parameters: [{key, data_type, unit}]}` | `Device.view` |
| `ask_questions` | 1–3 questions `{id, prompt, required, options ≤ 7}` | shown in the conversation | — |
| `recommend_path` | `{path: direct\|gateway\|adapter, source_type?, reason}` | for `direct`/`gateway` an `open_page` card to Add device with that mode | — |
| `propose_adapter` | `{mode: reuse, adapter_uuid}` or `{mode: create, name, artifact_uuid, source, summary}` | an immutable proposal `{uuid, kind, content_hash}` | `Device.view`; applying needs `Device.manage` + `Device.manage-connections` |
| `status` | `{}` | the adapter's checklist, source state, health, test result, deployment, discovered sources (≤ 20), outcome counts | bound adapter, `Device.view` |
| `samples` | `{limit ≤ 10}` | recent samples and failures with inputs (excerpts ≤ 8 KiB), fixtures | bound adapter |
| `fetch_now` | `{}` | redacted Fetch now result: status, duration, excerpt ≤ 16 KiB, ≤ 5 records, record count, next cursor | bound polling adapter, `Device.manage-connections`, shared limit |
| `test_decoder` | `{code, inputs?: fixtures\|samples}` | the manager's test result; nothing is recorded | bound adapter |
| `propose_change` | `{summary, evidence, code?, source?, fixtures?}` | an immutable proposal; `source` passes the save validation and cannot carry secrets | bound adapter |
| `next_step` | `{step: credentials\|secret\|test\|deploy\|activate\|cursor, message}` | a button card that opens that place in the workbench | bound adapter |
| `read_source` | `{source_id}` | as today | — |

The agent never receives `secrets`, `secret_snapshot`, webhook secret values, polling
credentials, Authorization headers or credential query parameters; Fetch now
excerpts are redacted before they reach it.
