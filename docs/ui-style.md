# Shared UI style

The portal and administration use the UI overhaul design and the shared shadcn components in `@iot-os/ui`. New features should follow this design rather than introducing their own shell or palette.

- Use `PageHeader` for page titles, actions, navigation and filter/time-control rows. Keep the sidebar grouped, collapsible and available on mobile.
- Preserve all three skins: Console (Geist), Instrument (IBM Plex), and Flight Deck (B612). Fonts are bundled locally. Skin tokens control typography, spacing, row height and corner radius.
- Default to dark mode while respecting the saved light/dark/system preference. Dark has two palettes on a third `<html>` axis, `data-palette`: Dusk (default; soft blue-grey surfaces, 15:1 text, visible card and border steps) and Ink (pure black, maximum contrast). Both are pre-painted from `localStorage` by `index.html` and owned by `PaletteProvider`. Flight Deck keeps its own dark colours. Use semantic surface, text, status and chart tokens from `globals.css`; never hard-code black or white.
- Controls follow one grammar. Text entry (Input, Textarea, InputGroup) is an inset field: `--input-fill`, an inner shadow and a `--input` border at 3:1 or better on its surface. Pickers (Select, SearchableSelect) share that field plus a divided chevron addon. Buttons are never inset: outline is a transparent frame. Read-only inputs render dashed with muted text; use `disabled` only for "not allowed now".
- Use shared searchable selectors for selection search. Use directory filters for standalone search. Preserve keyboard navigation, contrast and accessible names.
- Keep editor changes in drafts until Apply/Save. GPS settings use the same full-page panel editor as other dashboard panels. Saved legacy workflow location panels remain readable and editable.
- Dashboard time controls remain in the sticky page header. Kiosk mode hides surrounding navigation and exits with Escape while preserving drafts. Long canvases keep their layout and support Add panel below.
- Preserve actual telemetry/status meanings: missing data remains unknown, and device colours and chart series keep their own semantics.

Rebuild both portal and administration after shared UI changes and verify the served applications. Preserve unsaved browser edits during verification.
