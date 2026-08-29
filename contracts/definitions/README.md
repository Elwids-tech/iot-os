# Device Definition Contracts

These JSON Schema 2020-12 documents define the sole canonical Device Domain contract.

They establish:

- measured and derived parameters with required stable UUIDs;
- type-aware constraints and presentation metadata without inflating MQTT payloads;
- parameter-UUID mappings with explicit `on_missing` and `on_invalid` behavior;
- ordered structured calibration operations plus restricted CEL;
- separate semantic Commands and MQTT request/response mappings;
- logical Device drafts and exact Profile/Binding assignment inputs;
- Gateway communication identity and Gateway-to-logical-Device routes;
- route-aware Runtime Bundles and canonical telemetry; and
- semantic fixture checks for identity uniqueness, derivation cycles, target/type compatibility, route/channel compatibility, and bounded topic variables.

Authoring documents are editable inputs used by Laravel APIs, React forms, future AI proposals, and compiler requests. Artifacts and Runtime Bundles are immutable deterministic outputs carrying exact identities and hashes.

JSON Schema cannot prove every cross-document invariant. The canonical Go compiler in M1a-D4R3 remains responsible for CEL type checking, mapping coverage, dependency ordering, route resolution, deterministic artifact generation, and Command correlation.

Until D4R3 is implemented, JavaScript semantic checks provide contract-fixture evidence only; they are not runtime-ingestion evidence.
