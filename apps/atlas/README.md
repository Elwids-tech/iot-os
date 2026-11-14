# Platform atlas

An interactive map of how the platform works, for developers new to the repository.
Each diagram is a level: click a box with a magnifier to zoom into it, press Escape to
go up, and play the walkthrough to follow a message along the arrows. It is a
first full pass: 49 diagrams, from the system context through a "How it works" map
into ten branches (getting data in, storing and reading, activation and commands,
automation, alerts, dashboards, integrations and AI, access and tenancy, billing,
running it).

```bash
pnpm --filter @iot-os/atlas dev    # http://localhost:5180
pnpm --filter @iot-os/atlas lint   # tsc, design-system guardrails, content check
```

## Content

One JSON file per diagram in `content/`, typed by `src/model.ts`:

- `boxes` sit on a grid (`at: [column, row]`). A box with `opens` zooms into another
  diagram; a box with `detail` shows it, with its `code` and `docs` paths, in the side
  panel.
- `edges` join boxes. `bend` curves an edge, `labelAt` moves its label, `dashed` marks
  an exception path. An edge from a box to itself is a loop.
- `steps` are the walkthrough: each lights one edge or box and shows one sentence.

The contents tree is derived from `opens`, starting at `system.json`.

`scripts/check-atlas.mjs` fails when a diagram is unreachable, a reference does not
resolve, or a `code` or `docs` path no longer exists in the repository. The code is
the source of truth: when a diagram disagrees with it, fix the diagram.

## Writing a diagram

Read the code first, then draw. A doc may be out of date; a diagram must not be.

**What goes in**

- A diagram answers one question ("how does a command get confirmed?"). Six to
  twelve boxes; split it when it needs more.
- `kind`: `containers` for parts and their connections, `flow` for a sequence of
  work, `state` for a lifecycle. `tone`: `system` for our code, `store` for a
  database, stream or broker, `external` for things outside the platform, `person`
  for people, `state` for states.
- `summary`: two or three sentences. Box `detail`: one to three sentences saying what
  it does and the rule that matters, with `code` paths to the files that do it (two
  or three, the most telling ones) and `docs` paths to the feature doc or ADR.
- `steps`: six to twelve, one sentence each, in the order things happen. Each names
  an `edge` (or a `box`). Include the failure path, not only the happy one.
- Plain words. No customer, prospect or pilot names, host addresses or credentials:
  the repository is public.

**Layout**

- Boxes sit at `[column, row]`: columns 0 to 4, rows 0 to 3.2, fractions allowed.
  A cell is 260 by 150 pixels and a box 184 by 76, so neighbours in a row have a
  76-pixel gap: an edge label there fits about ten characters a line (break with
  `\n`). Leave a column free between two boxes for a longer label.
- Edges are straight, centre to centre. Lay boxes out so the main path reads left to
  right, then snakes back, and put exception paths on their own row.
- `bend` curves an edge to the left of its direction of travel (negative: right) by
  that many pixels at its middle; use it to pass around a box. Two edges in opposite
  directions between the same boxes are drawn side by side automatically. On a loop,
  a negative `bend` puts it under the box.
- Box labels are at most 26 characters and `sub` 40.

`node scripts/check-atlas.mjs` checks all of this: overlapping boxes, an edge drawn
through a box, a label wider than its gap. Add `--allow-unreachable` while a new
diagram is not yet opened by any box.
