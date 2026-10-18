# Research: Automation Nodes for Missing Data, Schedules and States

Findings from the code on `main` (22bc003) and the decisions they lead to. Paths are
relative to the repository root.

## What exists

- **Values.** `Value{Known, Value, At, Expires, Window, Token, Reason}`
  (`services/runtime/internal/dag/types.go:66-74`). A source value expires at
  `ObservedAt + fresh_seconds` (`evaluator.go:124`). `fresh()` replaces a stale value
  with `unknown("stale")`, losing `At` (`evaluator.go:26-31`).
- **Unknown stops actions.** Action nodes report `waiting`, "No usable condition value;
  no action was requested.", and keep their previous state, so unknown never opens or
  clears an alert (`evaluator.go:375-379`, `evaluator_test.go:30-48`).
- **Timers.** The next deadline is the earliest of window close, sustained deadline
  and source expiry (`evaluator.go:489-508`), stored in `dag_executions.next_timer`
  (`storage/dag.go:239`). The consumer loop calls `TickDAGs` about once a second
  (`app/rule_consumer.go:45-48`). A tick is recorded in the single `dag_clock` row with
  the stream's last sequence and fires only after the checkpoint reaches it, so a tick
  never overtakes unprocessed telemetry (`storage/dag.go:267-298`). A tick steps every
  enabled execution in every organization; only the due ones get a timeline entry.
- **Simulation** ignores `NextTimer`: time passes only on steps with a null event
  (`app/dag.go:34-72`). Saved scenarios start at 2030-01-01T00:00Z, a Tuesday, and a
  step without a device is a clock step (`ScenarioSimulation.php:13-102`).
- **Types.** Bindings are `number`, `boolean` or `string`; the portal maps enum,
  string, timestamp and bytes to `string` (`Automation.tsx:806-811`). A string can
  reach only `join.v1`, so no string or enum reading can drive an action today
  (`compiler.go:222-223, 310`). Config fields are `string`, `number`, `object` and
  `scalar`; there is no list type (`compiler.go:52-84`). Unknown keys are rejected.
- **Roots.** Only source, join and branch nodes are roots; constants do not count as a
  second source (`compiler.go:229-238`). Every workflow needs a binding, an action, and
  at most one alert action.
- **Editor.** Fields render generically (enum select up to 7 choices, otherwise
  searchable; number with min/max; object as JSON) unless the portal's `renderConfig`
  overrides them (`packages/workflow-editor/src/index.tsx:613-636`). Palette groups,
  icons and summaries come from a hard-coded map (`presentation.ts:81-288`); unknown
  types fall under **Other**.
- **Time zones.** Laravel resolves `Device::reportingTimezone()` (site, organization,
  UTC; `Device.php:25-30`). No runtime definition carries a zone. The runtime embeds
  `time/tzdata` (`app/http.go:17`). Spec 009 moves the device zone to its nearest
  entity.
- **Presence.** Sparkplug birth and death drive `device.presence.v1`. Losing a broker
  connection marks its devices' presence unknown ("Broker connection was lost; waiting
  for fresh birth certificates.", `app/application.go:204-207`).
- **Contract.** `contracts/rules/v2/workflow.schema.json` types `type` as a free string
  and `config` as an object; `tooling/verify-devices-contracts.py` validates each
  schema's `<stem>.fixture.json` and optional `<stem>.cases.json` in CI. The v2 workflow
  has no cases file yet.
- **Assistant.** The `schema` and `discover` tools return the live registry
  (`WorkflowAssistantTools.php:73-83`), so new types appear automatically; the prompt's
  hand-written guidance (`WorkflowAssistant.php:51-53`) needs updating.
- **Alerts.** The alert node's `title` is not read after the editor, every DAG alert is
  recorded as `warning` (`EventRecorder.php:54-66`), and Settings → Notifications lists
  only v1 workflows. Spec 011 (draft) lists DAG workflows there and adds channels; it
  adds no workflow action.

## Decisions

### D1. No data cannot fire for platform-side outages (owner to confirm)

- **Decision:** while a tick runs, No data for a device whose broker connection the
  runtime has recorded as lost is unknown ("broker connection lost"), and its silence
  clock restarts when the connection returns. Simulation has no connection state, so
  scenarios are unaffected.
- **Rationale:** a broker restart or certificate problem would otherwise open an alert
  for every device at once and bury the real incident, which service monitoring
  already reports. Ticks already use wall-clock time after draining the stream, so
  reading the recorded connection state at tick time is consistent with how timers
  work.
- **Alternatives:** (a) no guard, documented as a limitation: simplest, but noisy at
  exactly the wrong moment; (b) liveness watermarks published into the
  committed-telemetry stream per connection: deterministic on replay, but a new message
  kind on `iot.committed.telemetry.v1` (contract change for every consumer) and a
  device-to-connection map in every plan. Revisit (b) if replay determinism of ticks
  becomes a requirement.
- **To confirm in PR 1:** where the runtime records connection state that the
  evaluator can read in the tick transaction (presence rows in `device_runtime`, or a
  connection-state table written by the ingest).

### D2. No data keeps the last fresh reading time and an anchor

New `NodeState` fields: `LastFresh` (observed time of the latest fresh input) and an
anchor set at activation and on a connection restore. Output: false while
`at < LastFresh + period`; true once `at >= max(LastFresh, anchor) + period`; unknown
before a full period has passed since the anchor with no reading. The deadline joins
the next-timer minimum. The true value's token is `nodata:<deadline>`, so an action
fires once per silence episode; the false value carries the reading's token. The input
must come straight from a `source.parameter.v1` node, as for `window.v1`, and the
period must be at least the binding's `fresh_seconds`.

### D3. Schedule is a clock node, not a source

`schedule.v1` has no inputs and one boolean output, like `constant.v1` it is not a root
(no Correlate needed), and it emits a known value on every step whose `Expires` is the
next boundary. Its token is `schedule:<node>:<range start>`, so actions fire once per
range. The next boundary joins the next-timer minimum. Boundaries are computed by local
date in the configured zone; a start in a skipped hour moves to the transition instant,
and a repeated hour is not counted twice. The time zone is stored on the node (FR-012),
validated by Laravel (`timezone:all`) and by the runtime (`time.LoadLocation`).

### D4. A list field type

The registry gains `list` fields (`Items`: `string`, `number`, `boolean` or `object`,
plus `MaxItems`), validated by the compiler like the other field types. State match
uses a list of scalars (1–16); Schedule uses a list of `{start, end}` ranges (1–8) and a
list of ISO weekdays (1–7). The editor renders list fields with dedicated portal
components (`renderConfig`), and a generic fallback shows a JSON list editor.

### D5. Not and Range are their own nodes

Boolean logic always takes two inputs and every input must be connected, so a `not`
operator would leave `b` dangling. Compare's single-value config and its saved
workflows stay untouched if Range is a new type. Both are one-input, pure functions;
unknown in gives unknown out.

### D6. State match validates against the profile in Laravel

The runtime checks types (boolean values for boolean inputs, strings for string
inputs) but does not know enum choices. `DagAuthoring::compile` already loads each
binding's profile parameter; it additionally follows a State match node's input to its
source binding and rejects values outside the parameter's allowed values. The portal
offers those values from `dag/resources` (`parameters[].validation`).

### D7. Rate of change reuses window samples

`rate.v1` keeps samples in `NodeState.Samples` under the existing 10,000-sample bound,
input straight from a source (as `window.v1`). On each step it drops samples older
than the period and outputs `latest − earliest` or that per second, minute or hour,
unknown with fewer than two samples or a stale latest reading. The oldest sample's
expiry joins the next-timer minimum so the output updates when it leaves the period.
A change keeps the input unit; a rate's unit is compound (`°C/min`), which Arithmetic
and Unit conversion already reject.

### D8. Known values may carry a reason

Traces show `traceOutcome`'s generic "Condition is true." for known values. New nodes
set `Value.Reason` on known outputs too ("No reading for 15 min 4 s; last reading
09:41:12"), and the trace prefers it when present. Existing nodes keep their reasons.

### D9. Delivery order and no stacking

Four implementation pull requests, each based on `main` after the previous one merges
(stacked pull requests have missed `main` twice here). Each one carries its runtime,
contract fixture, editor, Laravel validation, assistant prompt, Help guide and
`docs/features/automation.md` changes, so every merged state is complete.
