#!/usr/bin/env node
// Design system guardrails for app code (.ts, .tsx and .astro). Errors fail `lint`; warnings list
// places to migrate. A reviewed exception carries `ui-check: allow <rule>` on
// the same or the previous line. Usage: node check-ui.mjs <dir> [<dir>...]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const rules = [
  {
    level: "error",
    name: "palette-colour",
    message: "Use semantic tokens (text-muted-foreground, bg-card, text-warning…) instead of Tailwind palette colours.",
    pattern: /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:red|green|blue|yellow|emerald|amber|slate|gray|zinc|neutral|stone|orange|lime|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|border|text|ring)-(?:black|white)(?:\/\d+)?\b/g,
  },
  {
    level: "error",
    name: "arbitrary-text-size",
    message: "Use the type scale (text-display, text-title, text-heading, text-body, text-meta, text-code, text-micro).",
    pattern: /\btext-\[[\d.]+(?:px|rem)\]/g,
  },
  {
    level: "error",
    name: "local-age",
    message: "Use RelativeTime or Freshness from @iot-os/ui/components/freshness instead of a local Age.",
    pattern: /function Age\s*\(/g,
  },
  {
    level: "error",
    name: "local-selected-style",
    message: "The selected tab or segment is primary, from the kit. Use Tabs, PageTabs or SegmentedControl without restyling the selected state.",
    pattern: /data-\[state=(?:on|active)\]:(?:hover:)?(?:bg|text|border|shadow)-[\w/[\]-]+/g,
  },
  {
    level: "error",
    name: "bare-toggle-group",
    message: "Use SegmentedControl from @iot-os/ui/components/segmented-control for a one-of-a-few choice.",
    pattern: /components\/toggle-group["']/g,
  },
  {
    level: "warning",
    name: "local-status-map",
    message: "Prefer statusOf/Status from @iot-os/ui/lib/status over a local value → tone map.",
    pattern: /Record<[^>]*,\s*(?:\[\s*StatusTone|StatusTone\s*>|\{\s*tone:\s*StatusTone)/g,
  },
]

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dist" ? [] : files(path)
    return /\.(tsx|ts|astro)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : []
  })
}

const dirs = process.argv.slice(2)
if (!dirs.length) {
  console.error("Usage: check-ui.mjs <dir> [<dir>...]")
  process.exit(2)
}
let errors = 0
const warnings = new Map()

// Phones: the kit's interactive controls keep 44 px targets under 768 px (FR-004). Every app's
// lint checks the kit sources too, so a kit edit that drops one fails wherever the kit is used.
const kit = join(dirname(fileURLToPath(import.meta.url)), "../src/components")
const phoneTargets = [
  ["button.tsx", /max-md:min-h-11\b/],
  ["input.tsx", /max-md:min-h-11\b/],
  ["select.tsx", /max-md:min-h-11\b/],
  // The switch grows its hit area (the `after` box), never the track.
  ["switch.tsx", /max-md:after:-inset-y-3\.5\b/],
  // A textarea's own minimum (min-h-16, 64 px) is already above 44 px.
  ["textarea.tsx", /\bmin-h-(?:1[1-9]|[2-9]\d)\b/],
]
for (const [name, pattern] of phoneTargets) {
  const file = join(kit, name)
  if (pattern.test(readFileSync(file, "utf8"))) continue
  errors += 1
  console.error(
    `error  phone-target  ${relative(process.cwd(), file)}  ${pattern}\n       Interactive kit controls need a 44 px target under 768 px (max-md:min-h-11); see Phones in docs/dev/design-system.md.`,
  )
}

for (const file of dirs.flatMap(files)) {
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, index) => {
    const allowed = `${lines[index - 1] ?? ""}\n${line}`
    for (const rule of rules) {
      if (allowed.includes(`ui-check: allow ${rule.name}`)) continue
      for (const match of line.matchAll(rule.pattern)) {
        const where = `${relative(process.cwd(), file)}:${index + 1}`
        if (rule.level === "error") {
          errors += 1
          console.error(`error  ${rule.name}  ${where}  ${match[0]}\n       ${rule.message}`)
        } else {
          warnings.set(rule.name, [...(warnings.get(rule.name) ?? []), where])
        }
      }
    }
  })
}
for (const [name, places] of warnings) {
  const rule = rules.find((r) => r.name === name)
  console.warn(`warning  ${name}  ${places.length} place${places.length === 1 ? "" : "s"}: ${rule.message}`)
}
if (errors) {
  console.error(`\n${errors} design system error${errors === 1 ? "" : "s"}.`)
  process.exit(1)
}
console.log("Design system checks passed.")
