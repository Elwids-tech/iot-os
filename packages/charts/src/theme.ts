import { useSyncExternalStore } from "react"

/**
 * Design tokens resolved to concrete colours. ECharts cannot read CSS
 * variables or every CSS colour space, so the bridge resolves each token in
 * the page's current theme and skin, then converts it to rgba.
 */
export type ChartTheme = {
  foreground: string
  muted: string
  border: string
  surface: string
  popover: string
  popoverForeground: string
  fontFamily: string
  monoFamily: string
  radius: number
  reducedMotion: boolean
  /** Resolves any CSS colour, including var(--token), in the current theme. */
  color: (value: string) => string
}

let version = 0
const listeners = new Set<() => void>()
let cleanup: (() => void) | null = null

function notify() {
  version += 1
  cache = null
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!cleanup && typeof window !== "undefined") {
    // Themes and skins switch through classes and data attributes on <html>.
    const observer = new MutationObserver(notify)
    observer.observe(document.documentElement, { attributes: true })
    const queries = ["(prefers-color-scheme: dark)", "(prefers-reduced-motion: reduce)"].map((q) =>
      window.matchMedia(q),
    )
    queries.forEach((query) => query.addEventListener("change", notify))
    cleanup = () => {
      observer.disconnect()
      queries.forEach((query) => query.removeEventListener("change", notify))
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && cleanup) {
      cleanup()
      cleanup = null
    }
  }
}

/** Parses rgb() and rgba() strings into channels; null for anything else. */
export function parseRgb(value: string): [number, number, number, number] | null {
  const match = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i)
  if (!match) return null
  const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4])
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha]
}

/** The same colour with a different opacity, for fills and hover shadows. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseRgb(color)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color
}

let cache: ChartTheme | null = null

let probeElement: HTMLSpanElement | null = null

/** One hidden element that inherits the page theme, used to resolve tokens. */
function probe() {
  if (!probeElement || !probeElement.isConnected) {
    probeElement = document.createElement("span")
    probeElement.style.display = "none"
    probeElement.setAttribute("aria-hidden", "true")
    document.body.appendChild(probeElement)
  }
  return probeElement
}

function read(): ChartTheme {
  if (cache) return cache
  const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  const colors = new Map<string, string>()
  const color = (value: string) => {
    const known = colors.get(value)
    if (known) return known
    const element = probe()
    element.style.color = ""
    element.style.color = value
    const computed = getComputedStyle(element).color
    let resolved = computed
    // Canvas converts oklch, lab and color() to sRGB bytes.
    if (canvas && !parseRgb(computed)) {
      canvas.clearRect(0, 0, 1, 1)
      canvas.fillStyle = computed
      canvas.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data
      resolved = `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`
    }
    colors.set(value, resolved)
    return resolved
  }
  const font = (token: string) => {
    const element = probe()
    element.style.fontFamily = `var(${token})`
    const family = getComputedStyle(element).fontFamily
    element.style.fontFamily = ""
    return family
  }
  const root = getComputedStyle(document.documentElement)
  const radius = parseFloat(root.getPropertyValue("--radius")) || 4
  const theme: ChartTheme = {
    foreground: color("var(--foreground)"),
    muted: color("var(--muted-foreground)"),
    border: color("var(--border)"),
    surface: color("var(--card)"),
    popover: color("var(--popover)"),
    popoverForeground: color("var(--popover-foreground)"),
    fontFamily: font("--font-sans") || getComputedStyle(document.body).fontFamily,
    monoFamily: font("--font-mono"),
    radius,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    color,
  }
  cache = theme
  return theme
}

/** The current chart theme; components re-render when the theme or skin changes. */
export function useChartTheme(): ChartTheme {
  useSyncExternalStore(subscribe, () => version, () => version)
  return read()
}

/** Escapes text placed in tooltip HTML; labels come from user data. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}
