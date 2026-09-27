# Shared UI style

The portal and administration use the UI overhaul design and the shared shadcn components in `@iot-os/ui`. New features should follow this design rather than introducing their own shell or palette.

- Use `PageHeader` for page titles, actions, navigation and filter/time-control rows. Keep the sidebar grouped, collapsible and available on mobile.
- Preserve all three skins: Console (Geist), Instrument (IBM Plex), and Flight Deck (B612). Fonts are bundled locally. Skin tokens control typography, spacing, row height and corner radius.
- Default to dark mode while respecting the saved light/dark/system preference. Use semantic surface, text, status and chart tokens from `globals.css`.
- Use shared searchable selectors for selection search. Use directory filters for standalone search. Preserve keyboard navigation, contrast and accessible names.
- Keep editor changes in drafts until Apply/Save. GPS settings use the same full-page panel editor as other dashboard panels. Saved legacy workflow location panels remain readable and editable.
- Dashboard time controls remain in the sticky page header. Kiosk mode hides surrounding navigation and exits with Escape while preserving drafts. Long canvases keep their layout and support Add panel below.
- Preserve actual telemetry/status meanings: missing data remains unknown, and device colours and chart series keep their own semantics.

Rebuild both portal and administration after shared UI changes and verify the served applications. Preserve unsaved browser edits during verification.
