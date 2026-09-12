# D1 local Python simulator

This simulator is for the existing **D1 / testing-d1** device in Acme Manufacturing, using its published **Smoke RGB Light, revision 1** profile. It publishes one downstream Sparkplug device with one `Brightness` Int32 measurement in percent.

The simulator starts at 50%, reports every two seconds, and accepts brightness commands from 0 to 100. It persists brightness and the Sparkplug birth/death counter between runs. It handles TLS, Host presence, rebirth, and clean disconnects. It does not automatically activate a logical device or issue commands.

## Current local setup

The Devices Compose overlay was enabled on 2026-09-07. Its runtime image built successfully and is running with the existing EMQX, NATS, database, and API. A dedicated D1 simulator gateway and namespace were provisioned. No extra meter or RGB-light device records were created.

Private credentials, certificates, the Python environment, process ID, and state are under ignored `.local/devices/`. Do not commit or share that directory.

The background instance records its PID in `.local/devices/d1.pid` and writes `.local/devices/d1.log`. Verify the PID belongs to `d1_simulator.py` before stopping it with `kill PID`. To run it in the foreground after stopping the existing instance:

```bash
.local/devices/python/bin/python tooling/simulators/d1_simulator.py \
  --config .local/devices/d1.json \
  --state-file .local/devices/d1-state.json
```

Stop a foreground instance with Ctrl-C. Run only one instance with these gateway credentials.

## Finish onboarding

1. Open **Devices → D1 → Configuration**.
2. Select **testing-d1 · D1 simulator gateway** as the discovered source. The Edge Node entry is the gateway itself.
3. Map the profile's **Brightness** parameter to the **Brightness** source metric. Enable its state command and select the same outbound metric if you want to test control.
4. Save the configuration draft, validate, then review and activate.
5. Open Measurements to see the current brightness. Use Commands to prepare and explicitly confirm a different percentage; the simulator then reports that new state.

Verified locally: runtime health, TLS connection, source discovery with Brightness 50%, and the source's availability in D1's onboarding selector. Logical device activation is left for the user to exercise the onboarding flow.
