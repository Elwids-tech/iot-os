# Shared UI

`@iot-os/ui` is the design system for the portal and administration: tokens
and skins (`src/styles/globals.css`), shadcn/ui primitives on Radix, and the
product components pages are built from (`Panel`, `Status`, `Freshness`,
`EmptyState` and, phase by phase, `DataTable` and the page templates).

- Gallery: `pnpm --filter @iot-os/storybook storybook`, then open
  http://localhost:6006.
- Plan and progress: [`plan/tasks/design-system.md`](../../plan/tasks/design-system.md).
- Portal and admin must not create their own shadcn copies or local versions
  of kit components.
