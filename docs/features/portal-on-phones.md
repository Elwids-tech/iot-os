# The portal on phones

People act on alerts from their phones: an alert email links straight to the alert, and
the pages it leads to work at phone width ([spec 033](../../specs/033-pwa-web-push/spec.md),
user stories 1 and 4). Phone width is under 768 CSS px. Tablets, landscape phones and
computers keep the full layouts. How the kit does it is in the design system's
[Phones](../dev/design-system.md#phones) section.

Code: portal [`src/alerts`](../../apps/portal/src/alerts),
[`src/devices/DeviceOverview.tsx`](../../apps/portal/src/devices/DeviceOverview.tsx),
[`src/dashboards`](../../apps/portal/src/dashboards); kit
[`page-header`](../../packages/ui/src/components/page-header.tsx),
[`filter-sheet`](../../packages/ui/src/components/filter-sheet.tsx),
[`data-table`](../../packages/ui/src/components/data-table.tsx) and
[`collection-page`](../../packages/ui/src/templates/collection-page.tsx); tests
[`e2e/phone.spec.ts`](../../apps/portal/e2e/phone.spec.ts).

## Pages that work on a phone

| Page | On a phone |
| --- | --- |
| Sign-in, password reset, invitation | The card spans the screen with 16 px sides. An alert link opened while signed out signs in and then opens that alert. |
| Home | Summary cards and panels stack in one column. |
| Alerts | One stacked row per alert or source: title, device, state and time. **Filters** opens every filter in a sheet (below). With manage access, selecting rows shows **Acknowledge selected** in a bar fixed to the bottom of the screen. |
| Alert detail | Facts in one column, the assignee picker full width, **Acknowledge alert** one tap away. Email deliveries are cards with the recipient, status and attempts, and **Retry email** on a failed one. A link to an alert that is gone, or that you can no longer see, says *This alert isn't available* and nothing more. |
| Devices | Cards, with search and **Filters** above them. |
| Device detail | Status and last seen in the header, then the latest readings with their age, then the device's alerts, then location, details, connectivity, installation, dashboards it is used in and recent commands. |
| Dashboards | The list as cards. |
| A dashboard | Panels in one column, in the order they read on a computer (top to bottom, then left to right). Each kind keeps a readable height: stat panels 3 rows, charts and maps 6, tables and alert lists 8. A wide table scrolls sideways inside its panel. **Time range** opens every time control in one popover: quick ranges, a custom range, stepping, compare, time zone and refresh. |
| Personal notification settings | Fits the screen. |

On every page the menu button opens the sidebar with the organization switcher and the
user menu, and the bell, **Assistant** and **Help** stay in the header. The bell's list,
Help and the Assistant open the full width of the screen. A page header keeps its main
action in view and puts the rest behind **More actions**. Every button and field is at
least 44 px tall, and fields use 16 px text so iOS does not zoom in. Pages still fit
with the phone's text at 200%; long rows wrap.

## The filter sheet

Lists show one **Filters** button with the number of active filters. It opens a sheet
from the bottom of the screen holding every filter the computer layout has: on Alerts
the condition (Active, Cleared, All), Grouped or Individual, **Unacknowledged only**,
**Assigned to me**, kind, device and workflow. Changes apply as you make them. **Clear
filters** returns to the default view and **Done** closes the sheet.

## Desktop only

Reachable on a phone, but laid out for a computer:

- **Editing dashboards.** A dashboard on a phone offers no **Edit**; the header says
  *Editing needs a larger screen*. A link that opens a dashboard for editing opens it to
  read. The computer layout is never changed from a phone.
- **Automations, device profiles and device adapters**, and the other settings pages.
