# UX Walkthrough: Onboarding Real Device Types (2026-10-31)

**Who did it.** The owner asked the agent to onboard new simulated devices of each
kind, once with the forms and once with the onboarding assistant, judging each
screen as a newcomer would. The goal was to find where the flow confuses people or
makes them leave the assistant to finish a step.

**Where it ran.** The local stack, in the seeded organization Acme Manufacturing,
with the assistant on (OpenAI). The code was `main` at f239b30, with the API family
from the spec 018 work in progress. That work does not touch onboarding.

**Simulators.**

- `tooling/simulators/vendor_env_sensor.py`, `vendor_webhook_cloud.py` and
  `vendor_tracker_api.py`.
- A new direct Sparkplug B meter. The existing Sparkplug simulator only behaves as a
  gateway (DBIRTH under a node), and the direct path needs a device that is its own
  edge node. The meter is kept locally, outside the repository, and is worth adding
  to `tooling/simulators`.

## Results

| Device | Forms | Assistant |
| --- | --- | --- |
| Sparkplug B, direct (new meter) | **Stored readings.** About 6 clicks; metrics matched automatically. | **Dead end.** It names the path, then: "I can't create the device or connection settings from here." It links back to the form with nothing filled in. |
| Own JSON over MQTT (ENV-0501, existing profile) | **Stored readings, for someone who can code.** It meant writing JavaScript and a JSON fixture with field names learned elsewhere, saving twice, testing, deploying and activating, across 5 tabs. | **Did not finish.** The new device type was blocked (detail 1). It proposed reusing the wrong adapter (detail 2). Each approval reset the conversation (detail 3). The decoder test never ran (detail 4). |
| Webhook (SNS-2004…2006) | Not repeated in full. Secret rotation and activation worked. The capture before deploy works as spec 020 built it. | **Partly.** It reused the right adapter and showed inline **Activate** buttons, which is the best moment of the day. The secret still had to be made in the form. Activating left the page and reset the conversation. |
| Polled API (TRK-1001…1003) | Stopped at Fetch now, which is the best "see your data" moment in the product: 24 real records in a table, each with **Add as fixture**. The steps after it are the same as MQTT. | **Did not finish.** It proposed repointing an existing polling adapter at the new account, which would silently change a live source. It asked for field names that one Fetch now would show. |

**Would a newcomer manage?** Only the Sparkplug B form, and the webhook path once
an adapter for that vendor exists. Every adapter path needs JavaScript, JSON
fixtures and JSON Pointers. The assistant could not carry a single device from
description to stored readings.

## What breaks the assistant flow

These are the problems the owner named: drafts, versions and approvals, and leaving
the assistant to find a button and then returning.

1. **It cannot draft a new device type from chat.** It says: "I'm blocked on the
   profile workspace validation: it requires a valid workspace evidence origin, and
   chat text can't be used for that step." It then offers fields to copy into the
   profile editor by hand. The internal wording also reaches the person
   ("evidence source record").
2. **It reuses the wrong adapter.** Asked to reuse a water-meter profile, it
   proposed "Use the adapter UX walk env sensors (MQTT)", an adapter bound to the
   environmental-sensor profile. For the trackers it proposed repointing a running
   polling adapter at another account. Reuse is chosen by source type and is shown
   as one confident card.
3. **Every approval resets the conversation.** Applying **Create draft** or **Use
   this adapter** navigates to the adapter page. The panel then opens a new, empty
   conversation ("Continue setting up …"), which no longer has the pasted sample,
   the answers or the plan. The assistant had just said "Once you approve the
   adapter, I'll add the decoder and test it."
4. **Its decoder test cannot use a pasted sample.** `test_decoder` takes only
   `inputs: fixtures|samples`, so it needs fixtures saved on the adapter or samples
   the adapter captured
   (`apps/api/app/Domain/Assistant/Tools/OnboardingTools.php`, `test()`). A new MQTT
   adapter has neither before it is deployed. The assistant reported "the tool
   rejected the sample input shape" twice, and then: "send another sample and I'll
   try the test again". That is a loop the person cannot leave.
5. **It asks again for what it was told.** Every first reply re-asked something the
   message already said: how the device sends data, the topic and the units. The
   same happened after each reset in detail 3.
6. **The question card blocks itself.** **Continue with these answers** stays
   disabled until the *optional* question is answered.
7. **Escape closes the whole assistant.** Pressing Escape to close an answer picker
   closed the assistant panel.
8. **Messages are lost silently.** A message sent while a run is in progress (for
   example right after **Dismiss**, which starts its own run) stays in the box
   unsent.
9. **It gets values wrong without anyone seeing.** Its first decoder divided flow in
   millilitres per minute by 1000 and by 60. The proposal is reviewed as code,
   without the decoded values that would expose the mistake.
10. **One reply was shown twice** (the webhook path).
11. **The secret and Start collecting cannot happen in the chat.** The rules require
    a person to do them, which is right. But the person is sent to a tab to do them
    instead of getting the button in the conversation.

## What makes the forms flow confusing

- **The data comes last.** A published profile is needed first. MQTT input is
  invisible until a decoder is deployed: "No captured samples yet" while ENV-0501
  was publishing.
- **The checklist is wrong about samples.** It said "Capture samples · Done · 1 test
  sample" for a placeholder fixture (`"serial": "REPLACE-WITH-SERIAL"`) before
  anything arrived.
- **The starter decoder guesses fields from the profile** (`payload.serial`,
  `battery_voltage`, `uptime`). The payload has `device_id`, `battery_v` and
  `uptime_s`.
- **The topic filter is a prefilled value**, `meters/+/telemetry`, not a hint.
- **Saving makes the draft unsaved again.**
  - **Save draft** reformats the fixture JSON, the page then shows "Draft saved"
    and "Unsaved changes" together, and **Run sample tests** stays disabled.
  - A second save made another revision. One intended save produced drafts 2
    and 3.
- **Operational detail during first setup.**
  - A brand-new adapter says "the applied revision continues running".
  - The deploy tab shows the revision hash, rollback and **Pause adapter**.
  - "Source unknown · Publisher unknown" is shown before anything exists.
- **Statuses disagree.**
  - "Connect · Done · Deliveries arriving" sits next to "HTTP webhook: No
    deliveries in 24 hours".
  - Waiting counts: Home 30, Add device 19.
- **The profile picker has duplicates.** Two "RGB Light (simulator)" entries cannot
  be told apart.
- **The polling form is very technical.** It asks for JSON Pointers, cursor kinds,
  paging and placeholders. It does give good defaults, such as the header name
  `x-api-key`.

## What works and should stay

- **The Sparkplug B direct wizard.** It confirms the connection, matches metrics
  automatically, previews values with units, activates in one click, and shows the
  first stored readings.
- **Fetch now.** It shows real records before anything is deployed, with **Add as
  fixture**.
- **The activation dialog**, plus the "devices ready to activate" list with an
  **Activate** button per serial in the assistant panel. This is the right pattern,
  extended to every step.
- **Webhook secret handling.** The secret is shown once, rotation keeps the old one
  working, and simulator deliveries were accepted straight away.

## The flow the owner asked for: the assistant keeps you in the flow

Six rules make the assistant a guide that finishes the job.

1. **One conversation per setup, everywhere.**
   - It is bound to the setup, not the page, and follows the person across pages.
   - Approving something never starts a new conversation.
   - Leaving and coming back resumes the same thread.
2. **Every step ends in an action card inside the chat.**
   - **Use these settings**, **Use this mapping**, **Create device type**, **Create
     secret**, **Start collecting** and **Activate 3 devices** are buttons in the
     card.
   - The person presses them, so principle V still holds: the AI proposes and the
     person acts.
   - The card shows the result, such as decoded values, the secret once, or the
     progress of Start collecting. Then the assistant continues without being asked.
   - Credentials stay in a small form inside the card, never in the chat text.
3. **Values, not code.** Proposals show what each sample becomes, for example
   "WM-2001 → flow 12 L/min, total 53 L". Code stays behind **Show code**.
4. **Ask only what is missing.**
   - Read the message, attachments and captured input first.
   - Use Fetch now and captured input to find fields.
   - Never block on an optional answer.
5. **Reuse only what fits.** Offer an existing adapter only when its profile and
   source settings match, never by source type alone. Say what would change. For a
   new account or endpoint, create a new source.
6. **Progress in the chat.** Show "Step 3 of 4 · Choose readings" and what is left.
   After Start collecting, show the first stored reading with **Open device**,
   **Add another**, **Dashboard** and **Alert**.

## Effect on spec 021

Most of the forms findings are already in spec 021:

- data first and capture before deploy (FR-020 to FR-024);
- no-code mapping and live preview (FR-030 to FR-037);
- the generated device type (FR-040, FR-041);
- one ordered Start collecting (FR-050 to FR-055);
- Setup and Manage, one status, one count (FR-060 to FR-065);
- placeholders, not values (FR-010).

The assistant findings change spec 021:

- **FR-072** puts suggestions in the step's form. The owner wants the approval in
  the conversation. Both can hold: the action card applies to the same form state
  and shows the result in the chat.
- **FR-071** gains persistence. The conversation follows the setup across pages and
  approvals.
- **FR-074** gains a sentence: the assistant shows the Start collecting card with the
  summary, and the person presses it in the chat.
- **New requirements:**
  - the assistant drafts the device type from chat;
  - test with pasted and captured samples;
  - reuse only on a profile and settings match;
  - no repeated questions;
  - optional answers never block;
  - Escape closes only the picker;
  - queued messages are never lost;
  - values-first proposals;
  - batch activation in the chat;
  - the native Sparkplug B paths in the assistant (create the onboarding, show the
    kit, watch for the birth, offer **Activate**).

Details 1 to 8 are defects in today's assistant and can be fixed before spec 021
lands.
