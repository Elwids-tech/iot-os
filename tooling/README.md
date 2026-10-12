# Developer Tooling

`bootstrap` installs the pinned Task binary into `.tools/bin`, creates `.env` only when absent, and runs the environment doctor. It does not install global language runtimes or overwrite developer configuration.

`doctor` treats Docker and the repository-local Task binary as initial requirements. Local Node, pnpm, PHP, Composer, and Go installations are reported for convenience; pinned container and CI toolchains will remain authoritative.

`versions.env` records the pinned application toolchain and the Docker versions the setup was verified with.

`taskw` at the repository root always prefers the pinned local Task binary.

Everything else here is described in the docs: test harnesses (`test-*.mjs`) and
verification scripts (`verify-*`), the contract checker's tests (`contracts/`) and the
documentation link checker (`docs/`) in
[testing](../docs/dev/testing.md);
`simulators/` in [simulators and fixtures](../docs/dev/simulators-and-fixtures.md);
`hardware/` in [hardware](../docs/hardware/waveshare-audio-board.md); `release/` in
[release](../docs/ops/release.md); `monitoring/` in [monitoring](../docs/ops/monitoring.md).
