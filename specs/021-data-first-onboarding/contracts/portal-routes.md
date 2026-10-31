# Portal Routes and Screens

## Routes

| Path | Screen | Replaces |
| --- | --- | --- |
| `/devices/add` | The start screen (US4) | `/devices/onboard` (redirects, keeping `?mode=` mapped to a connector and `?profile=`) |
| `/devices/add/:setupUuid/:step` | A journey step: `connect`, `data`, `readings` or `collect` | `/devices/onboard/:deviceUuid?step=` (redirects to the device's setup) |
| `/data-sources` | The data source list (`CollectionPage` and `DataTable`), one status column | `/device-adapters` |
| `/data-sources/:adapterUuid/:section?` | Manage, with sections `devices`, `readings`, `activity`, `settings` and `revisions`; a source in Setup redirects to its setup step | `/device-adapters/:adapterUuid` |
| `/data-sources/new` | Redirects to `/devices/add` | `/device-adapters/new` |

## Journey shell

- **Layout**: a `Stepper` with the four steps. It holds the step body in a `Panel`
  and step and connector help in the side help (FR-101).
- **Bottom bar**: a sticky action bar with **Back**, **Save and continue** and,
  inside the bar, **Ask the assistant** when the assistant is enabled. The bar uses
  `ref={keepToastsAbove}`.
- **Leaving**: unsaved edits use `useUnsaved`.
- **Assistant**: the panel opens the setup's one conversation on every page of the
  setup, its source and its draft device type (`GET device-setups/{setup}/conversation`).
  Applying a card, even one that navigates, keeps the same conversation open. Cards
  render as `ActionCard`s in the conversation and as `SuggestedValue`s in the step's
  form. Messages typed during a run are queued, and Escape closes only the innermost
  picker.

## The steps

- **Connect**: the connector's settings form from the registry. Examples are
  placeholders (FR-010). Tenant broker: the kit is downloaded in the same step, and
  topic filters are optional.
- **See data**:
  - A live list of captured input (polled every 2 seconds while open) with time,
    topic or path, size, retained flag, and the payload in a read-only `JsonEditor`,
    or as hex and text.
  - Above it, the connector's reasons, each with explanation and fix.
  - **Paste a sample**.
  - Polling sources show **Fetch now** in the step.
  - Off-filter messages appear in their own group with **Add a filter**.
- **Choose readings**:
  - Left: a field tree built from every captured and pasted sample. It shows paths,
    example values and type differences, and highlights the suggested identity,
    time and readings.
  - Right: the chosen readings, with key, label, type, unit (`UnitField`), scale and
    offset.
  - Below: every sample decoded again within 1 second.
  - Then the device type choice: reuse a match, or name a new type.
  - **Edit as code** and **Reset to mapping**.
- **Start collecting**:
  - A summary of the device type, the decoder with each sample's result, the
    settings without secrets, and the serials with checkboxes.
  - **Start collecting** (a `ConfirmDialog`), then the rollout's progress.
  - Then the success state: first readings with `RelativeTime`, plus **Open device**,
    **Add a dashboard**, **Create an alert** and **Add another of this type**.

## Kit additions

These go in `packages/ui`, each with a story:

- `ActionCard`: an assistant proposal in the conversation, with:
  - a title and what it changes;
  - a values preview, such as decoded samples or the device type's readings;
  - optional embedded fields (password fields for `credentials`, serial checkboxes
    for `start` and `activate`);
  - the primary control, **Show code** and **Dismiss**;
  - the states `open`, `applied` (with its result), `out_of_date` and `dismissed`.
- `SuggestedValue`: the same proposal in the step's form. A field wrapper with a
  **Suggested** marker, the change it makes, and keep or discard.
- `SuggestionBar`: **Keep all** and **Discard all** in the form.
- `FieldTree`: a JSON field tree with checkable leaves, example values and badges.

Everything else composes `Stepper`, `ChoiceCard`, `Panel`, `JsonEditor`,
`DataTable`, `Status` and `statusOf`, `RelativeTime`, `Freshness` and `EmptyState`.
New status domains go in `lib/status.ts`: `setupStep` and `rollout`.
