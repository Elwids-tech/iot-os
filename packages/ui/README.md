# Shared UI

`@iot-os/ui` is the design system for the portal and administration: tokens
and skins (`src/styles/globals.css`), shadcn/ui primitives on Radix, and the
product components and page templates pages are built from (`Panel`,
`DataTable`, `Status`, `Freshness`, `EmptyState`, `CollectionPage`,
`EntityPage`, `InboxPage`, `WorkspacePage`, `SettingsPage`).

- Gallery: `pnpm --filter @iot-os/storybook storybook`, then open
  http://localhost:6006.
- Rules for new UI: [docs/dev/design-system.md](../../docs/dev/design-system.md).
- Portal and admin must not create their own shadcn copies or local versions
  of kit components.
