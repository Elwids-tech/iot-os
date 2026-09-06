# Design QA — Sparkplug onboarding prototype

## Comparison target

- Source visual truth: `/Users/tharindarodrigo/.codex/generated_images/01a0500d-b4ec-7fd2-8c3f-3abad34d538b/exec-b51d63e9-1b5a-4f38-99fb-6ae5ac83d29b.png`
- Browser-rendered implementation: `qa/mapping-implementation.png`
- Compared state: **Map parameters**, RGB LED 01 selected, Power on, Colour `#00FF00`, Mode `blink`, Brightness `7`.
- Source dimensions: 1487 × 1058 px.
- Implementation dimensions: 1295 × 921 px, captured from the in-app browser at 1309 × 931 CSS px with device scale factor 1.1. The comparison normalized by matching the same application state and reviewing both images together; browser chrome and capture density were excluded from visual findings.

## Evidence and checks

- Full-view comparison: source and implementation were opened together in the same visual review input.
- Focused comparison: horizontal stepper, mapping table, validation summary, fixed action footer, and sidebar/navigation were visually inspected.
- Browser interactions verified: selected the RGB LED discovery candidate; moved into mapping; changed Mode to `rainbow`; progressed through Verify and Activate; confirmed the active state; navigated back; reloaded; confirmed the primary Verify action remained enabled.
- Console: no warning or error entries during the tested flow.
- Responsive check: `qa/mobile-discovery.png` captured at a 409 × 818 CSS-px in-app browser viewport. No horizontal overflow (`scrollWidth: 395`); the mobile stepper shows only the active step label.

## Findings and fixes

- [P2 — fixed] The activation state previously disabled the primary action after navigating back to Map parameters.
  - Fix: only disable the primary action after a completed activation on the final step.
  - Evidence: browser check confirmed `Verify definition` is enabled after reload and return to mapping.

- [P2 — fixed] The original mobile stepper allowed all step labels to collide.
  - Fix: compact mobile mode keeps the horizontal step circles but shows only the current-step label.
  - Evidence: `qa/mobile-discovery.png`.

- [P3] The implementation uses system sans-serif fallback rather than the generated concept’s unknown display font. The hierarchy, weights, scale, and compact operational density are preserved; a final portal typography token can replace this during production UI-system work.

## Fidelity surfaces

- Typography: clear display heading, compact labels, readable table text, and deliberate control sizes; no wrapping or truncation defects in the reviewed state.
- Spacing and layout: source’s sidebar, horizontal progression, wide mapping table, validation band, and fixed action bar are retained. The action bar no longer obscures the validation result.
- Colors and tokens: white/cool-gray field, deep navy text, cobalt primary actions, mint health/validation states, and restrained borders match the selected direction.
- Image and icon quality: the reference has no photographic or illustration assets. The prototype uses the Lucide icon library for functional UI icons; no placeholder artwork or handcrafted SVG/CSS illustration is used.
- Copy and content: reflects the approved Sparkplug B onboarding language and RGB LED parameters.
- Accessibility: semantic buttons, labels for all editable controls, visible keyboard focus styles, native selects/range controls, and explicit status labels are present.

## Implementation checklist

- [x] Build horizontal four-step onboarding flow.
- [x] Make discovery, parameter controls, verification, activation, and back navigation interactive.
- [x] Verify browser flow, console, build, and Sites worker packaging.
- [x] Check compact mobile behavior.

**final result: passed**
