# ADR-055: An Adapter Has One Draft, Edited in Place Until a Deployment Uses It

**Status:** Proposed
**Date:** 2026-11-27
**Amends:** [ADR-010](ADR-010-per-tenant-adapter-runtimes.md) ("Laravel owns adapters, immutable revisions")

## Context

ADR-010 made every adapter revision immutable, so every save created a new numbered
revision. Iterating on a decoder (one save, one assistant proposal, one sample swap at
a time) left a trail of drafts: an adapter could read "revision 11 live · draft 15"
with drafts 12 to 14 never tested or deployed. That number told people nothing useful,
and the drafts were never needed again: only deployed revisions are rolled back to or
named by running devices.

Device profiles and automations already work the other way: one draft is edited until
it is published or deployed, and only then does a new version exist.

## Decision

1. **The newest revision of an adapter is its draft.** Saving edits that row in place
   (definition, content hash, secret snapshot) until a deployment uses it.
2. **A revision is frozen once a deployment uses it**: it is the applied or desired
   revision, or any deployment, pause or rollback operation names it. The next save
   then creates revision N + 1, which becomes the new draft. Deployed revisions stay
   exactly as deployed, so rollback, installations and the runtime's acknowledgement
   keep pointing at what ran.
3. **Tests follow the content.** A save that changes the content hash clears the
   draft's test result; a save with the same content keeps it. Only a revision that
   passed its test can be deployed, unchanged.
4. **`draft_revision` stays the save counter** on the adapter. It still goes up on
   every save, so a stale page, a test started before a save, or an assistant proposal
   made for an older draft is refused as before. Screens show the revision number
   (`revision.revision`), not the counter.

## Consequences

- An adapter reads "revision 11 live · draft 12" however many times draft 12 was
  saved. Drafts saved before this change keep their numbers.
- Revision numbers for an adapter are no longer the number of saves; nothing used them
  that way.
- The draft's `created_by` is whoever opened it; each save is still in the audit log
  (`device.adapter.draft.saved` with both `draft_revision` and `revision`).
