#!/usr/bin/env node
// The portal never spells the platform's name itself (spec 036, FR-009): a billing
// account's brand replaces it. Code takes the name from `productName()` or
// `PLATFORM_NAME` in @iot-os/api-client, or from `useProductName()` in the portal.
// Fails on the name anywhere but a comment. A reviewed exception carries
// `product-name: allow` on the same or the previous line.
// Usage: node check-product-name.mjs <dir> [<dir>...]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const NAME = /IoT OS/
const ALLOW = "product-name: allow"

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dist" || name === "__fixtures__" ? [] : files(path)
    return /\.(tsx|ts|js)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : []
  })
}

const dirs = process.argv.slice(2)
if (!dirs.length) {
  console.error("Usage: check-product-name.mjs <dir> [<dir>...]")
  process.exit(2)
}

let found = 0
for (const dir of dirs) {
  for (const path of files(dir)) {
    const lines = readFileSync(path, "utf8").split("\n")
    let block = false
    lines.forEach((line, index) => {
      const text = line.trim()
      // Comments may name it: they explain, and nobody reads them in the portal.
      const comment = block || text.startsWith("//") || text.startsWith("*") || text.startsWith("/*") || text.startsWith("{/*")
      if (text.includes("/*") && !text.includes("*/")) block = true
      if (text.includes("*/")) block = false
      if (comment || !NAME.test(line.replace(/\/\/.*$/, ""))) return
      if (line.includes(ALLOW) || (lines[index - 1] ?? "").includes(ALLOW)) return
      found++
      console.error(`${relative(process.cwd(), path)}:${index + 1}  the platform's name is written out. Use productName(), PLATFORM_NAME or useProductName().`)
    })
  }
}
if (found) process.exit(1)
