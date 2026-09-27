# Shared UI style

The portal and administration use the same Twin Studio-inspired theme through
`@iot-os/ui/globals.css`. Keep new interactions in the shared shadcn components;
do not introduce page-specific palettes or replace their accessible primitives.

- **Surfaces:** black in dark mode, white in light mode. Panels meet at thin
  neutral borders. Cards are flat and square; controls have 4px corners and
  overlays have 6px corners. Reserve elevation for overlays.
- **Type:** locally bundled IBM Plex Sans for UI and JetBrains Mono for code.
  The desktop body is 13px, compact labels are 12px, and secondary metadata is
  at least 11px. Numeric values use tabular figures. Keep existing heading
  hierarchy and descriptive labels.
- **Actions:** white on black / black on white for primary actions. Secondary
  actions use neutral outlines or ghost buttons. Cyan identifies selection,
  links and keyboard focus, rather than decorating every control.
- **Status:** normal and informational badges are quiet neutral text. Warnings
  use amber and errors use red, with explicit text or icons. A missing value
  remains unknown, never a successful zero. Data-series colors and actual device
  colors retain their separate meanings.
- **Density:** 28px default desktop buttons and inputs, a 44px shell header,
  and a 224px collapsible navigation rail. Coarse pointers get larger controls
  and 16px editable text. Reduced-motion preferences are respected.
- **Themes:** retain the existing system/light/dark preference. All surfaces,
  inputs, focus indicators, code editors and charts consume semantic tokens;
  no per-page dark-mode color overrides are needed.

Restyling does not alter component props, authorization, device lifecycle,
profile activation, or form state. Rebuild both `portal` and `admin` after
shared UI changes and verify the served applications, including light/dark
themes, keyboard focus, overlays, tables and mobile navigation.
