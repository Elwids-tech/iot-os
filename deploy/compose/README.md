# Development Compose Profile

The development profile starts the shared dependencies required by the platform workspaces:

- PostgreSQL with TimescaleDB
- Redis
- NATS with JetStream
- EMQX
- Node-RED
- MinIO-compatible object storage

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

`deps:down` does not delete volumes. A destructive reset command is intentionally deferred until its exact targets and recovery expectations are documented.

These credentials and port exposures are development-only. The production profile will use generated secrets, TLS, restricted exposure, and stronger network boundaries.
