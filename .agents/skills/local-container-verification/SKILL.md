---
name: local-container-verification
description: Rebuild and verify the local IoT platform containers after implementation, dependency, configuration, or UI changes in this repository. Use before reporting a change complete or handing the running application back to the user.
---

# Local container verification

The user requires container rebuilds after changes. A source edit, passing
typecheck, or host-side build alone does not update the Docker-served application.

## Required completion steps

1. Finish the changes and run the checks appropriate to them.
2. Rebuild and recreate every affected local service before reporting completion.
   Changes to shared UI, authentication, or API-client packages affect both
   `portal` and `admin`. API changes affect `api`; Go runtime changes affect
   `runtime`. Check Dockerfiles for other shared build inputs.
3. Use the existing Compose project, environment files, and active overlays.
   Preserve databases, volumes, credentials, TLS configuration, and running
   simulators. Never reset the stack or regenerate credentials just to rebuild.
4. Check that the rebuilt services are running, then verify the changed behavior
   through the served application. For UI changes, inspect the rendered page and
   exercise the relevant controls; HTTP success alone is insufficient.
5. If a later fix changes a deployed artifact, rebuild the affected service again
   and repeat the relevant verification.
6. Report what was rebuilt and verified. If rebuilding fails, diagnose and retry
   within the task's scope; explicitly report any remaining blocker instead of
   claiming that the running application contains the change.

Rebuilding the local application is already authorized as part of implementation;
do not ask the user to request it again. This does not authorize production
deployment.

## Current Devices development stack

Run from the repository root. Prefix shell commands with `rtk`.
Check that these files still exist and match the active stack before use; do not
print private environment files or expanded configuration containing secrets.

```bash
rtk proxy docker compose \
  --env-file .env \
  --env-file .local/devices/devices.env \
  -f deploy/compose/compose.dev.yml \
  -f deploy/compose/compose.app.yml \
  -f deploy/compose/compose.devices.yml \
  up -d --build --no-deps portal admin
```

Replace `portal admin` with the affected services. Use `--no-deps` when the
required dependencies are already running; include a dependency when the change
actually requires updating it. Preserve the active overlay when rebuilding
`api`, particularly its private runtime authentication and broker settings.

The portal is normally served at `http://localhost:5173`, administration at
`http://localhost:5174`, and the public API at `http://localhost:8001`.
Verify the actual ports rather than assuming them if the stack has changed.

## Browser handoff

Check for unsaved changes before refreshing a user's tab. Preserve them and use a
separate verification tab when needed. Leave the updated UI accessible and explain
which tab contains the rebuilt version. Do not save or discard the user's draft
just to validate the deployment.
