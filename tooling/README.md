# Developer Tooling

`bootstrap` installs the pinned Task binary into `.tools/bin`, creates `.env` only when absent, and runs the environment doctor. It does not install global language runtimes or overwrite developer configuration.

`doctor` treats Docker and the repository-local Task binary as initial requirements. Local Node, pnpm, PHP, Composer, and Go installations are reported for convenience; pinned container and CI toolchains will remain authoritative.

`versions.env` records the selected application toolchain and the Docker versions used to verify this M0 slice.

`taskw` at the repository root always prefers the pinned local Task binary.
