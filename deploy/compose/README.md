# Development Compose Profile

For the opt-in Sparkplug B device runtime on the existing EMQX service, see [Devices v1 setup and recovery](../../docs/devices-v1.md). `compose.devices.yml` adds TLS, scoped broker access, and a private runtime; `compose.devices-test.yml` is the separate disposable integration environment. Run `./taskw devices:setup`, then `./taskw devices:config` to validate the overlay before opting in with `./taskw devices:up`. Existing databases also need the additive permission seeder documented in the guide. The runtime container built and started successfully on 2026-09-07; see the D1 simulator guide for the local walkthrough.

The development profile starts the shared dependencies required by the platform workspaces:

- PostgreSQL with TimescaleDB
- Redis
- NATS with JetStream
- EMQX
- Node-RED
- MinIO-compatible object storage
- Mailpit invitation-mail inbox

Images are pinned in `.env.example`. Local named volumes preserve data when services stop.
The PostgreSQL initialization scripts enable the TimescaleDB extension on a new development database.

```bash
./tooling/bootstrap
./taskw deps:up
./taskw deps:status
./taskw deps:smoke
./taskw deps:logs
./taskw deps:down
```

The application profile layers the Laravel API, tenant portal, and React administration images on top of these dependencies:

```bash
./taskw stack:up
./taskw stack:status
./taskw stack:logs
./taskw stack:down
```

The tenant portal is available at `http://localhost:5173`, administration at `http://localhost:5174`, and the API at `http://localhost:8001`. The API runs outstanding migrations but no longer reseeds accounts on restart. For existing databases, run the additive permission upgrade in [Device Profile Studio](../../docs/device-profile-studio.md). Run demo seeders explicitly only when initializing a new development database. This is a development profile, not a production deployment.

Invitation emails are captured by Mailpit at `http://localhost:8025`. The invite URL targets the local tenant portal; production deployments must provide their own SMTP and `FRONTEND_URL` configuration.

The local-only demo accounts all use the password `password`:

- `super-admin@example.test` — platform super admin
- `platform-admin@example.test` — configuration-only platform administrator
- `shared.operator@example.test` — member of both demo organizations
- `acme.moderator@example.test`
- `acme.member@example.test`
- `northstar.admin@example.test`
- `northstar.member@example.test`

`deps:down` does not delete volumes. A destructive reset command is intentionally deferred until its exact targets and recovery expectations are documented.

These credentials and port exposures are development-only. The production profile will use generated secrets, TLS, restricted exposure, and stronger network boundaries.
