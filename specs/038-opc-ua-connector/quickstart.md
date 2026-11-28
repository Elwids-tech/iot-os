# Quickstart: validating the OPC UA connector

Run in the local stack with the adapter overlay. Each scenario belongs to the pull
request named in the [plan](plan.md#delivery) and is what that pull request must show
working before it is reported done. `tooling/verify-opcua.mjs` automates B to F
through the API.

## Prerequisites

- The stack is up (`./taskw devices:up`) with adapters enabled and
  `IOT_ADAPTER_ALLOW_PRIVATE_BROKERS=true`, so connections may reach the simulator.
- The simulator overlay is added to the usual compose command:
  `-f deploy/compose/compose.bms-simulator.yml up -d bms-simulator`.
- Signed in to the portal as an organization admin of the check organization.

## A. The simulated building (PR 1a and 1b)

1. Start the simulator and connect a standard OPC UA client to
   `opc.tcp://localhost:4840`.
2. Browse Example Campus → Example Tower → Level 3 → East → Zone box `L03-VAV-2`.
   **Expect** 14 points; zone temperature has a unit, a range and a good status.
3. Open `bms_controls.html`, switch on **controller offline** for that zone.
   **Expect** its points turn bad (no communication); every other zone stays good.
4. Restart with `--style flat`. **Expect** one folder of tags, the same point count.
5. Sign in as the operator and write 21 to that zone's temperature setpoint.
   **Expect** the effective setpoint changes at once and the zone temperature reaches
   it within 30 simulated minutes. Write 40. **Expect** the write is refused as out of
   range. Write as anonymous. **Expect** it is refused as not allowed.
6. Switch on **power outage**. **Expect** the transfer switch reads generator, the
   generator runs and the main meter reads no power.
7. Start with `--size tower`. **Expect** fourteen levels, 2,466 points; the floor
   sub-meters add up to the main meter within 1%.
8. `--export-model` prints the building; its totals match
   [the building plan](building.md#totals-and-sizes).
9. `pytest tooling/simulators/test_bms_*.py` passes.

## B. The connector core (PR 2)

1. `cd services/adapters && node --test test/opcua-*.test.cjs` against the simulator:
   endpoints, each security and sign-in choice, each failure reason, browse paging,
   resolve after `--node-ids renumber`, subscribe, rhythm read, quality mapping.
2. Run the memory measurement with `--size large`. **Expect** a recorded figure and a
   decision on the runtime limit (research R2).

## C. Connect and browse (PR 3)

1. Build → Device adapters → New → **OPC UA server**. Enter
   `opc.tcp://bms-simulator:4840`. **Expect** the encrypted choice preselected.
2. **Expect** the server certificate shown with its fingerprint; accept it.
3. Download the platform's certificate. (The simulator trusts it automatically unless
   started with `--strict-trust`; with it, **expect** "Server does not trust the
   platform's certificate" until the file is added.)
4. Sign in with the simulator's test name and password. **Expect** **Connected**.
5. Wrong password → **Sign-in refused**. Stop the simulator → **Address not
   reachable**. Switch on `session_limit` with a client already connected → **Server
   too busy**.
6. Open the tree. **Expect** levels loading one at a time with live values.
7. As a member of another organization, request the connection and its nodes.
   **Expect** `404`.

## D. Choose readings (PR 4)

1. Open one zone controller (`L03-VAV-2`), choose **Map this**, tick zone temperature,
   temperature setpoint, damper position and occupancy, and use them.
2. Ask for similar equipment by **Point names**. **Expect** the 14 zone boxes of the
   standard building, none lacking a reading. (By **Declared type**, **expect** the 8
   with reheat: the cooling-only and core boxes declare other types.)
3. Create and publish the device type "Zone controller" from the readings, or choose it.
   Save, open **Review** and check. **Expect** 14 devices, 4 readings, 56 points, a
   current value for each reading, at least 16,128 rows a day, no problems.
4. Restart the simulator with `--style flat`, map the `Example Tower tags` folder,
   filter `L03_VAV_2.`, tick the same four tags. **Expect** the prefix `ET_L03_VAV_2`
   and the same 14 found by tag pattern; rename the keys to the device type's and the
   review passes the same way.

## E. Start collecting (PR 5)

1. Deploy. **Expect** one waiting source per zone box of the map (14 in the standard
   building) in the Devices tab and in Discovery.
2. Select all and **Activate**. **Expect** a device for each, with its readings and
   units, within a minute.
3. Change a setpoint through the controls page. **Expect** it on the device page
   within 15 s (SC-002).
4. `controller_offline` on one zone. **Expect** its readings unknown with "No
   communication with the device"; it goes offline by the normal rule; the others
   stay online.
5. `uncertain_value` on one point. **Expect** the value shown and labelled uncertain.
6. Leave a zone steady for 30 minutes (or run at `--speed 60`). **Expect** it stays
   online.
7. `server_restart` for 2 minutes. **Expect** **Server unreachable**, then collecting
   resumes by itself and the gap stays a gap.
8. `meter_replaced` on an activated meter. **Expect** the counter reset rule applies.
9. Runtime tests and `./taskw devices:test` pass unchanged (SC-010).

## F. Run it (PR 6)

1. The data source's Overview. **Expect** connected since, security, points read and
   bad, and the last problems.
2. `certificate_changed`. **Expect** collecting stops with **Server certificate
   changed**; accepting the new one resumes it; both are in the activity log.
3. Map more points than the organization's limit. **Expect** the review to say by how
   much and deployment refused.
4. Ask the assistant to add the electricity meters. **Expect** a point map proposal
   to review; no deploy.
5. Run the connector against a server the project did not write (research R13).
   **Expect** stored readings (SC-007).

## G. On-site agent (PR 7)

1. Start the agent on a network the platform cannot reach into, with an enrolment
   code. **Expect** it listed as connected with its version.
2. Complete C to E with **Runs at: site agent**.
3. Cut the agent's uplink for 10 minutes. **Expect** all readings from the gap to
   arrive with their original times, without marking devices online late or firing
   automations for the past.
4. Revoke the agent. **Expect** nothing more arrives.

## H. Hierarchy proposal (PR 8, with spec 009 built)

1. Apply the buildings preset, then run the proposal on the structured building.
   **Expect** 1 site, 1 building, 4 levels, 14 zones, zone controllers placed at their
   zones and floor meters at their levels, matching `--export-model`.
2. Rename a floor, drop a zone, apply. **Expect** entities and placements created;
   none refers to OPC UA.
3. Run it again. **Expect** only the dropped zone offered.
4. With the entities feature off, **expect** no proposal action anywhere.
