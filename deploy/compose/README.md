# Development Compose Profile

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

The application profile layers the Laravel API and React administration image on top of these dependencies:

```bash
./taskw stack:up
./taskw stack:status
./taskw stack:logs
./taskw stack:down
```

The local application is available at `http://127.0.0.1:5174` and the API at `http://127.0.0.1:8001`. The API image runs migrations and the safe development seeders on startup. This profile is for local development only; production images, secrets, TLS, and orchestration remain separate deployment work.

Invitation emails are captured by Mailpit at `http://localhost:8025`. The invite URL targets the local React administration application; production deployments must provide their own SMTP and `FRONTEND_URL` configuration.

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
