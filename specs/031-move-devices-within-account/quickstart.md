# Quickstart: Verify Moves on the Local Stack

Runnable checks for [spec 031](spec.md). Each implementation pull request runs the
sections it lists in the plan's [Delivery](plan.md#delivery) table, on a stack rebuilt
from its branch ([local container verification](../../.agents/skills/local-container-verification/SKILL.md)).
Endpoints and payloads are in [the API contract](contracts/platform-api.md).

## Prerequisites

- The full stack (`./taskw devices:setup`, `./taskw devices:up`) with adapters enabled,
  rebuilt with the PR's services (`api` and workers, `runtime`, `portal`, `admin`), and
  `./taskw doctor` green.
- Two organizations, **A** and **B**, on one billing account, and a third, **C**, on
  another account. Create B from the **Billing accounts** page as an owner of A's
  account, or attach it in the admin app.
- People:
  - `mover`: Organization Admin in A and B;
  - `b-only`: Admin in B only;
  - `a-only`: Admin in A only;
  - `c-admin`: Admin in C.
  Use the `.test` addresses the seeders use.
- In A, a webhook or polling adapter fed by the local simulator, with three activated
  devices X, Y and Z of one published profile.
- Rebuild only the services the PR changes
  ([rebuild one service](../../docs/dev/local-setup.md#rebuild-one-service)), and keep
  any unsaved browser edits when reloading pages.

## 1. Tests

```bash
rtk proxy ./taskw test
```

```bash
cd apps/api && rtk php artisan test --compact --filter=Moves
```

```bash
rtk proxy pnpm --filter @iot-os/portal lint
```

Expected: green on PostgreSQL/TimescaleDB, with `DeviceMoveIsolationTest` among the
tests that ran. For PRs that change the runtime or contracts, also run
`./taskw runtime:test` and `python3 tooling/verify-devices-contracts.py`.

## 2. Move an adapter-fed device (US1; PRs 031-1 and 031-2)

1. As `mover`, in A's **Devices**, select X, choose **Move to organization**, pick B,
   accept every preselected choice and confirm. With 031-1 alone, run the same steps
   through `POST device-moves/preview` and `POST device-moves`.
2. Expected:
   - **Done** reaches *completed*.
   - Within one minute B's X stores new readings, with no change to the adapter or the
     simulator (SC-002).
   - A's X is archived **Moved to B**, keeps its readings and stores none after the
     cutover.
   - Y and Z keep reporting.
   - The adapter restarted once.
3. As `b-only`, every one of these is 404 through B's routes (A's own routes answer
   403, as they do for any non-member):
   - A's adapter, its credentials, deliveries and Discovery;
   - A's gateway list, and the adapter's gateway route.
   B's X shows **Moved from A**, the cutover time, and **Adapter: *name* (A)** with
   online state and nothing else.
4. As `a-only`, the adapter's Sources tab shows X's source **In use in B**, with no
   link and no B device data.
5. As `c-admin`, `GET device-move-targets` in C doesn't list A or B. `POST
   device-moves/preview` naming A or B as the target gets 404.
6. The account's device count and this month's peak are the same before and after the
   move (SC-006). Read them on the admin app's billing account page.
7. Move B's X back to A. It is an ordinary device in A again (no `pipe.hosted`). Its
   code is prefilled as `<code>-2`, because A's archived X keeps its code.

## 3. Refusals and races (US1)

1. Start activating Y and, while it is pending, try to move it. The review shows
   **Waiting for the runtime** and can't be confirmed.
2. Confirm the same move from two browser tabs. The second gets 409 and nothing
   changes.
3. Change a successor code to one used in B. The review refuses it in place.
4. At the account's device limit, move an active device. The move completes and the
   successor arrives active.

## 4. Dashboards and automations come along (US2; PRs 031-3 and 031-4)

1. In A, set up:
   - dashboard D1 and automation W1 using only X;
   - dashboard D2 and automation W2 using X and Y;
   - W1 and W2 running, W1 with a recipient who is a member of B.
2. Move X to B, accepting the preselected choices. Expected:
   - D1 and W1 are in B on B's X, and W1 is running and raises its next alert in B
     (SC-004). A's W1 is archived as **Moved to B**.
   - B has a copy of D2 with only X's panels.
   - A's D2 is unchanged, marks X **Moved to B** and saves.
   - W2 is suspended in A, naming X, until X is removed from it.
   - The review offered **Add 1 device to this move** on W2, and an archive needed its
     own tick on **Confirm**.
3. Archive a dashboard and an automation outside a move. They hide behind **Show
   archived**, and a restored automation comes back off.

## 5. Gateway pipes (PRs 031-5 and 031-6)

1. In A, put two devices behind a simulated gateway. Move one to B.
2. Stop the gateway. Expected:
   - A gets the gateway offline alert for its own device;
   - B gets an alert for its device naming the gateway only.
3. As `a-only`, try to delete the adapter from section 2 and to reject B's source.
   Both are refused, naming B and a count.
4. Pause the adapter. A confirmation names B and one device. After confirming, B's
   device shows **Adapter paused**.

## 6. Direct devices (US3; PR 031-7)

1. Move a simulated direct device from A to B while it publishes. Its readings appear
   in B within one minute with unchanged settings.
2. As `a-only`, the gateway and its settings are 404. As `mover` in B, the warning says
   A's members knew the credentials.
3. Rotate the credentials in B. Expected:
   - the simulator's old settings are refused at once;
   - with the new settings it reports again;
   - the warning is gone.
4. A capture of the device started in B records its messages.

## 7. Onboard into B (US4; PR 031-8)

From A's adapter **Discovery**, activate a new serial into B. Expected:

- B stores its readings.
- A's Discovery shows it **In use in B**.
- Both activity logs record it.

## 8. History across the move (US6; PR 031-9)

1. Move a device with a day of history from A to B with **Include readings from before
   the move**. Expected:
   - B's chart is continuous across the cutover;
   - earlier points are labelled as recorded in A.
2. Stop it on A's archived device. B sees nothing before the cutover.
3. Move another device without the option. B sees nothing before its cutover.
4. Move that device back to A, with or without the option. The review says it
   reconnects to the readings it recorded in A. A's chart for the new device is
   continuous from its readings before the first move: B's (with the option) and its
   own follow, and A's readings carry no "recorded in" label (FR-053).

## 9. The assistant (US7; PR 031-10)

With the assistant enabled, ask it in A to move X to B. Expected:

- The card shows the same rows and choices as the bulk action.
- Nothing changes until **Confirm** in the card.
- The result matches section 2.

With `IOT_ASSISTANT_ENABLED=false`, sections 2 to 8 still pass.
