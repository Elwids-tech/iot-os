# Dashboard regression fixes

Resolved the chart measurement and enabled-button contrast regressions.

## Chart rendering

The recorded React maximum-update-depth error came from Recharts' legend
bounding-box callback, which stores viewport position in state. Dashboard grid
items also used CSS transitions through intermediate positions and dimensions.

Dashboard panel geometry now updates immediately rather than transitioning.
Dragging, resizing and responsive placement still work. Time-series labels render
as an accessible list outside the measured chart, retaining series names and
colour swatches without the legend's position/state feedback path. Chart zoom,
tooltips, axes and time-range behavior remain available.

## Button contrast

The mobile audit reproduced a 4.47:1 contrast ratio while an enabled primary
button was still fading from disabled opacity. Shared buttons now transition
colours, borders, shadows and transforms, but change opacity immediately. Disabled
buttons retain their disabled appearance; enabled buttons start at full opacity.
A browser regression captures the first painted frame after a real dashboard
edit enables Save. Reintroducing `transition-property: all` makes that test fail.

## Verification

- Full 16-test dashboard browser suite, including editing, drag/resize, zoom,
  refresh, draft conflicts, mobile keyboard access and accessibility.
- Ten repeated runs each of workflow panels, responsive chart/capture/refresh,
  and immediate enabled-button opacity (30 stress scenarios).
- 34 portal unit tests and portal/shared-UI typechecks.
- Rebuilt portal and administration containers and inspected desktop/mobile UI.

Visual QA note: Chromium full-page capture can omit transformed panel content
even while pre/post-capture rectangles and regular viewport screenshots remain
correct. The regression test still exercises full-page capture, then saves a
regular viewport image for inspection. No layout-width collapse was observed
in the instrumented run.

The visual builder remains deferred. Continue with pilot-driven machine-view
contracts after these fixes; no API/runtime behavior or customer records changed.
