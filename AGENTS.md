# Project workflow

- After making changes, rebuild the affected local containers and verify the
  running application before reporting completion. Follow
  [.agents/skills/local-container-verification/SKILL.md](.agents/skills/local-container-verification/SKILL.md).
  Rebuild again after any subsequent implementation fix.
- Use suitable shared shadcn components for each interaction. Search within a
  selector belongs in a searchable selector, not a separate search field paired
  with a dropdown. Standalone search fields are appropriate for directory and
  table filters.
- Preserve the user's unsaved browser edits when verifying rebuilt pages.
- Prefix shell commands with `rtk`; use `rtk proxy` when unfiltered output is needed.
