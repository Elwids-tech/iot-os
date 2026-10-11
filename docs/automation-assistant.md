# Automation configuration assistant

Open **AI assistant** in an automation editor (or the sidebar **Assistant**
control while the editor is open) to explain the current draft or describe a
new behavior. The conversation lives in the shared workspace panel's **Ask**
tab, so it keeps the editor's draft and evidence handlers while the panel
stays open across the editor's own tabs. The assistant can inspect the node registry, applied
device configurations, controllable settings, and saved geofences. It reuses the
profile assistant's configured OpenAI provider, queue, budget, cancellation,
private conversation storage, and recovery path.

The assistant produces a compiler-validated **Review proposed workflow** card.
Review changed nodes, device settings, and the complete configuration, then
choose **Use this draft**. This only changes the editor's local graph and is
undoable. Save the draft and review activation separately. No assistant tool
can deploy a workflow or send a device command.

Every request includes the current graph, including unsaved edits. The proposal
retains that baseline. If the editor changes while the response is generated,
the old proposal cannot replace it; request a new proposal against the updated
draft. Saving still checks server revisions, and activation still validates
command grants and applied device configurations.

Automation conversations use the `automation` scope and require Workflow.manage
and the organization's automation feature flag. Device and geofence discovery
uses the same permissions and resource projections as the editor. Command
proposals require Device.command. Profile conversations remain separate.
Conversations can be reopened from the searchable conversation selector.

The user's request, draft, and requested resource configuration are sent to the
configured provider. Device credentials are not supplied. When explaining an execution, the selected recorded telemetry, node decisions, and action delivery snapshot are supplied.
Geofence geometry is copied into a proposed node; later boundary edits do not
update that copy. The model may ask for missing details rather than produce a
proposal. A generated graph is a configuration suggestion, not proof of runtime
behavior; simulation and execution inspection remain available in the editor.

Limits: the draft context is limited to 30,000 JSON characters, history to six
recent exchanges, and resource discovery to paginated results. Arbitrary file
uploads are not supported in automation conversations. Existing profile file
uploads are unchanged.

## Explain a recorded execution

In **Execution → Execution timeline**, select an evaluation and choose
**Explain this execution**. The assistant describes its deployed generation and
revision, decisive conditions, suppressed actions, and recorded delivery outcome.
The button opens the workspace panel on a conversation for that evaluation and
starts the explanation; follow-up questions use the same evaluation, and **Back
to the draft conversation** returns to the editable draft's conversation.

The server fetches evidence through the authorized timeline API and stores a
snapshot with each assistant run. It does not trust client-supplied execution
facts. Retries reuse the original snapshot. Each response displays its capture
time because action delivery can progress later. Step, action, and evaluation
citations open the exact evidence in the timeline without replacing editor
changes. Unrecognized references are plain text, never arbitrary links.

Execution evidence and the current editable draft are distinct contexts.
Explanations do not create proposals unless a change is requested. Requested
changes use the existing compiler-validated proposal and stale-draft review.
Command approval is not device confirmation, and observing a target state does
not prove a speaker sounded or a physical actuator moved.

An unavailable evaluation cannot be explained. Evidence larger than the configured
60,000-character context allowance is refused without silently removing steps.
Runtime trace truncation is disclosed. Existing Workflow.manage, Workflow.view,
organization boundaries, private conversation ownership, budgets and cancellation
remain enforced. Snapshots live with the private assistant conversation; removing
runtime history does not retroactively rewrite an existing answer.
