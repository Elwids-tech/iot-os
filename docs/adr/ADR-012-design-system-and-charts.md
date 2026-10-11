# ADR-012: One Design System Kit, and ECharts for Charts

**Status:** Accepted (recorded retroactively)
**Date:** 2026-10-11; decided 2026-10-10 during the design-system rollout
**Relates to:** [ADR-007](ADR-007-monorepo-and-shadcn-ui.md)

## Context

ADR-007 put shadcn components in a shared `packages/ui`. That gave the portal
and admin the same primitives, but nothing above them defined a list page, a
detail page or an editor, so pages were assembled by hand. An audit found six
list layouts, four pagers, four empty-state styles, six page widths and three
separate status maps for the same device command. Charts used Recharts through a
kit wrapper, with different behaviour on dashboards and device pages.

## Decision

`@iot-os/ui` ([`packages/ui`](../../packages/ui)) is the single design-system
layer for the portal and admin, built in layers:

| Layer | Contents |
| --- | --- |
| Tokens | Colour, surfaces, elevation, radius, density, skins (Console, Instrument, Flight Deck), dark palettes (Dusk, Ink), named type scale, motion ([`globals.css`](../../packages/ui/src/styles/globals.css)) |
| Primitives | shadcn/ui on Radix (`radix-nova` style), Tailwind v4 |
| Product components | `Panel`, `DataTable` (TanStack Table), `Status`/`statusOf`, `RelativeTime`/`Freshness`, `PropertyList`, `Pager`, `EmptyState`, `DraftBar`, `CommandPalette`, … |
| Page templates | `CollectionPage`, `EntityPage`, `InboxPage`, `WorkspacePage`, `SettingsPage` |

- Keep shadcn on Radix; do not migrate to another primitive library. Open-source
  dependencies only.
- Pages compose a template and kit components; apps do not keep local copies of
  kit components or local status maps.
- Guardrails are enforced in lint: [`packages/ui/scripts/check-ui.mjs`](../../packages/ui/scripts/check-ui.mjs)
  runs in `pnpm --filter @iot-os/portal lint` and the admin equivalent, and in the
  release workflow.
- Storybook ([`apps/storybook`](../../apps/storybook)) is the gallery; every kit
  component and template has a story.
- All charts use Apache ECharts through [`packages/charts`](../../packages/charts)
  (an `EChart` wrapper, the SVG renderer, a token-to-colour theme bridge and
  shared option builders). Recharts is removed from every workspace.

The rules for new UI are in [design system](../dev/design-system.md).

## Consequences

- New screens are faster to build and look like the rest of the product.
- The kit is shared code: a change affects both apps, so both must be rebuilt and
  checked.
- Guardrails only catch what they encode (palette colours, raw text sizes, local
  `Age` components, local status maps as a warning); reviews still matter.
- A few pages are not yet on templates or still have local patterns; they are
  listed in the [roadmap](../roadmap.md#next).
