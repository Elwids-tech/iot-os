import * as React from "react"

/**
 * Dark palette: which set of dark colours applies when the theme is dark.
 * Dusk is a soft blue-grey with visible surfaces; Ink is pure black for OLED
 * screens and high-contrast preference. Light mode ignores the palette.
 */
export type Palette = "dusk" | "ink"

export const palettes: { value: Palette; label: string; description: string }[] = [
  { value: "dusk", label: "Dusk", description: "Soft surfaces, easier on the eyes" },
  { value: "ink", label: "Ink", description: "Pure black, maximum contrast" },
]

// index.html sets data-palette from this key before first paint; keep the two in sync.
export const PALETTE_STORAGE_KEY = "iot-palette"

export const isPalette = (value: unknown): value is Palette =>
  palettes.some((palette) => palette.value === value)

const PaletteContext = React.createContext<{
  palette: Palette
  setPalette: (palette: Palette) => void
} | null>(null)

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = React.useState<Palette>(() => {
    const current = document.documentElement.dataset.palette
    return isPalette(current) ? current : "dusk"
  })
  const setPalette = React.useCallback((next: Palette) => {
    document.documentElement.dataset.palette = next
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, next)
    } catch {
      // Storage can be blocked; the palette still applies for this page.
    }
    setPaletteState(next)
  }, [])
  useThemeColorSync()
  const value = React.useMemo(() => ({ palette, setPalette }), [palette, setPalette])
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>
}

export function usePalette() {
  const context = React.useContext(PaletteContext)
  if (!context) throw new Error("usePalette must be used within a PaletteProvider.")
  return context
}

/**
 * Keeps <meta name="theme-color"> equal to the page background so mobile
 * browser chrome matches whichever theme, skin and palette is active.
 */
function useThemeColorSync() {
  React.useEffect(() => {
    const root = document.documentElement
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement("meta")
      meta.name = "theme-color"
      document.head.appendChild(meta)
    }
    const sync = () => {
      const color = getComputedStyle(document.body).backgroundColor
      if (color && meta && meta.content !== color) meta.content = color
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-skin", "data-palette", "style"],
    })
    return () => observer.disconnect()
  }, [])
}
