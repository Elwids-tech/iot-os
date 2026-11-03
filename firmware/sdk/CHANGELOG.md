# Changelog

The SDK has its own version (`VERSION`), recorded in every kit. Before 1.0, breaking
changes are listed here.

## Unreleased

### Added

- The core: Sparkplug B codec, edge-node session (bdSeq, sequence, will, host state,
  rebirth, back-off, session takeover detection), devices of shared types, paced births,
  writers with datatype and range checks, commands matched by name, and gateway health
  metrics. No heap and no writable static data.
- MQTT over a TLS byte stream with the vendored coreMQTT v2.3.1, and a level for modems
  that run MQTT themselves.
- Desktop ports (`ports/posix`): mbedTLS over sockets, clock, file storage, stderr log,
  pthread lock.
- Annotated templates for the stream, clock, storage, log and lock ports.
- The desktop gateway simulator (`examples/desktop-simulator`) with a 500-device
  self-test.
- Contract fixtures that the runtime replays (`contracts/sparkplug/fixtures/sdk`).
