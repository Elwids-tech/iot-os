# Quickstart: Data-First Device Onboarding

These are runnable checks that prove the journey end to end in the local stack. They
use the simulators, never real vendor accounts. Time each scenario from the first
click on **Add device**; the success criteria give the limits.

## Prerequisites

- **Stack**: the devices stack with the adapter overlay
  ([local setup](../../docs/dev/local-setup.md)), rebuilt from this branch:
  - `adapter-manager`, `webhook-receiver` and `adapter-runtime-image`;
  - the API family and the portal;
  - the admin app, for scenario I.
- **Development env**: the private adapter env file sets these, as for spec 020:
  - `IOT_WEBHOOK_PUBLIC_URL=http://localhost:8095` and `IOT_WEBHOOK_RECEIVER_TOKEN`;
  - `IOT_ADAPTER_ALLOW_PRIVATE_BROKERS=true`;
  - `IOT_ONBOARDING_TEST_CONNECTORS=true`.
- **Profiles**: no published profile for the environment sensor. Scenario A must
  create its device type.
- **Python**: simulators run with `.local/devices/python/bin/python`.
- **Automated check**: `node tooling/verify-onboarding.mjs` drives scenarios A–C
  through the API and fails on any missed time limit.

## A. Tenant broker, no code (US1, US2, US3; SC-001, SC-003, SC-004)

1. **Start**: **Add device** → "The device can send to a server address I choose" →
   "It sends its own format". Connect shows the kit with no topic question. Download
   it.
2. **Run the simulator**:
   `python tooling/simulators/vendor_env_sensor.py --kit <kit>/device-config.json --serial ENV-0042`.
   - Within 10 s, See data lists messages on `sensors/ENV-0042/telemetry` with time,
     size and payload.
   - No profile exists and no revision is deployed.
   - The page suggests the filter `sensors/+/telemetry`.
3. **Wrong credentials**: edit the kit's password and restart the simulator. Within
   10 s See data shows "The device's password was refused" with the fix. Restore the
   password.
4. **Choose readings**:
   - Suggested: identity `/device_id`, time `/ts` (epoch seconds), and readings
     `temperature`, `humidity`, `battery_v`, `rssi`, `snr` and `uptime_s`.
   - Keep `temperature`, `humidity` and `battery_v`. Rename `battery_v` to
     `battery`, unit V. Every sample decodes within 1 s of each change.
   - Name the device type "Environment sensor". No profile is offered for reuse.
5. **Start collecting**:
   - The summary lists the new device type with three readings, the samples passing,
     and `ENV-0042` checked. Confirm.
   - The steps turn done in order: Test, Publish device type, Deploy, Activate
     devices.
   - The success state shows a stored temperature with its age.
   - Total time is under 10 minutes, with no code typed and no other page visited.
6. **Code and immutability**: open the device type in the profile editor. It is a
   published revision with three parameters. Open the decoder with **Edit as code**:
   it is the interpreter plus the mapping.

## B. Webhook vendor cloud (US1, US2, US3; SC-002)

1. **Start**: "It's in the manufacturer's cloud" → "Their cloud can send to a web
   address". Connect shows the ingest URL and **Create secret**, which works as in
   spec 020.
2. **Run the simulator**:
   `python tooling/simulators/vendor_webhook_cloud.py --url <ingest URL> --secret <secret> --devices 3`.
   Deliveries appear in See data. With `--bad-signature`, the reason "Signature does
   not match" appears with the fix.
3. **Choose readings**:
   - Choose the list of messages as records and the sensor ID field as identity.
     Keep two readings.
   - The field tree flags a sample where a value arrives as a string.
   - Reuse the profile offered when one matches; otherwise create one.
4. **Start collecting** with the three serials checked. Each is activated after its
   next delivery. The total is under 15 minutes.

## C. Polling a tracker API (US1, US2, US3; SC-002)

1. **Start**: `python tooling/simulators/vendor_tracker_api.py --port 8096 --api-key <key>`.
   Then "It's in the manufacturer's cloud" → "They give me an API key". Fill the
   request as in spec 020's quickstart B, with the URL as a placeholder until typed.
2. **See data**: **Fetch now** shows status 200 and records. A wrong key shows
   `http_401` with the fix. The returned records join the captured input. Leave and
   resume: they are still there, and none is labelled pasted.
3. **Choose readings and Start collecting**: map latitude, longitude, temperature
   and battery, with the record time as the source time. Start collecting. The
   first stored readings are source-timed.

## D. Vendor MQTT broker (US1; FR-122)

1. **Broker**: start a throwaway Mosquitto on the host at port 1884, with a
   username and password.
2. **Simulator**: run
   `python tooling/simulators/vendor_env_sensor.py --broker mqtt://host.docker.internal:1884 --username u --password p --serial ENV-0100`.
   The `--broker` mode is added in this feature.
3. **Start**: "They give me an MQTT server". Fill in the URL, credentials and topic
   `sensors/#`. See data shows messages before anything is deployed.
4. **Wrong password**: shows `credentials_rejected`.

## E. Native Sparkplug B in the same steps (FR-003, US4)

1. **Start**: "The device can send to a server address I choose" → "It speaks
   Sparkplug B". The stepper reads Connect, See data, Choose readings and Start
   collecting.
2. **Run the simulator**: `python tooling/simulators/sparkplug_simulator.py` with the
   kit. See data shows the birth. Choose readings matches metrics to the chosen
   profile. Start collecting activates.
3. **Same behaviour**: the behaviour equals today's wizard, and the API calls are the
   same.

## F. Resume, permissions and Manage (US4, US6; FR-052, FR-062, FR-064, FR-065)

1. **Resume**: leave scenario A after See data. Devices and Home list the setup with
   **Resume**, which reopens See data. The waiting count is the same in the sidebar,
   on Add device and on Discovery.
2. **Permission handoff**: as a member without `Device.activate`, run Start
   collecting. Test, Publish and Deploy finish, and the setup shows that it waits for
   someone who can activate devices. A manager opens it and confirms, and activation
   finishes.
3. **Manage**:
   - Opening a collecting source shows Manage with "Receiving from 1 device · last
     message …" and no checklist.
   - Stop the simulator's credential (revoke it). The sentence names the refused
     credential at the source.
   - Change `temperature`'s scale and **Apply changes**. The old revision keeps
     storing until the new one is applied.

## G. The assistant carries the setup (US5; SC-009 to SC-012)

1. **Tenant broker, from a description**:
   - Open **Add device** and type "A temperature and humidity sensor that sends its
     own JSON to an MQTT server I choose".
   - In the conversation, press **Use this path**, then **Create connection kit**.
     Start `vendor_env_sensor.py` with that kit; this is the only step outside the
     conversation.
   - The conversation shows the first messages, then a **Use this mapping** card with
     each sample's decoded values. Press it, then **Create device type**.
   - Press **Start collecting** on the summary card with ENV-0042 checked. The card
     shows the progress, then the first stored reading.
   - Navigate to the device and back to the source: the same conversation is open,
     with its history.
2. **Webhook**:
   - Describe the vendor cloud.
   - Press **Use these settings**, then **Create secret**. The card shows the URL and
     the secret once; start `vendor_webhook_cloud.py` with them.
   - Then **Use this mapping** (records list), **Use this device type** (a reuse
     offer, if a profile matches) and **Start collecting** with three serials.
   - The transcript, the card's stored result and the model's context never hold the
     secret (SC-010).
3. **Polling**:
   - Describe the tracker and paste `tooling/simulators/vendor_tracker_api.md`.
   - Press **Use these settings**, and type the API key into the `credentials` card.
   - The assistant runs Fetch now, shows the records and proposes the mapping with
     source time. Press it, then **Start collecting**.
   - A wrong key gets an explanation and a fix in the conversation.
4. **Sparkplug B direct**:
   - Describe "a meter with its own Sparkplug B publisher".
   - Press **Create device**, take the kit, and start
     `tooling/simulators/sparkplug_direct_meter.py` with it.
   - The birth appears; press **Use these matches**, then **Activate**.
5. **What must hold throughout** (SC-011, SC-012):
   - Every step was pressed in the conversation, and it never reset.
   - The assistant never asked for a fact it was given, and never offered to reuse a
     source with a different device type or account.
   - Typing while it works queues the message, and Escape closes only pickers.
6. **Assistant disabled**: repeat scenario A with `IOT_ASSISTANT_ENABLED=false`. Every
   step works in the forms, and the start box takes a pasted message only (SC-009).
7. **Evaluation**: the assistant tests run the onboarding evaluation fixtures with
   the agent faked: spec 020's set plus one setup per connector, a Sparkplug B
   direct device included. No credential or secret appears in any reply, context,
   tool result or card result, and no answered question is asked again.

## H. Reuse and a new connector (US7, US8; SC-007, SC-008)

1. **Another device**: from scenario A's success state, **Add another of this type**,
   then a new kit. Run the simulator with `--serial ENV-0043`. See data shows the new
   serial. Start collecting activates it, with no Choose readings. It takes under 2
   minutes.
2. **Copy**: **Start from an existing setup** on scenario B's source. The copy has no
   secret, a new ingest URL and the same mapping, and its test must pass.
3. **Test connector**: the test connector `lab_mqtt` appears on the start screen. It
   completes A's steps with the simulator's `--topic lab/ENV-0099/data`. No other
   screen changed.

## I. Measurement (FR-110)

The admin app's **Onboarding** page lists scenarios A–H by connector. It shows
reached steps, completions, median minutes to the first reading, and the assistant
and code shares. It contains no payloads or names.
