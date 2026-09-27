import * as React from "react"

export type Skin = "console" | "instrument" | "flight-deck"

export const skins: { value: Skin; label: string }[] = [
  { value: "console", label: "Console" },
  { value: "instrument", label: "Instrument" },
  { value: "flight-deck", label: "Flight deck" },
]

// index.html sets data-skin from this key before first paint; keep the two in sync.
export const SKIN_STORAGE_KEY = "iot-skin"

export const isSkin = (value: unknown): value is Skin =>
  skins.some((skin) => skin.value === value)

const SkinContext = React.createContext<{
  skin: Skin
  setSkin: (skin: Skin) => void
} | null>(null)

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkinState] = React.useState<Skin>(() => {
    const current = document.documentElement.dataset.skin
    return isSkin(current) ? current : "console"
  })
  const setSkin = React.useCallback((next: Skin) => {
    // Set the attribute before rendering so computed variables (usePanelGap) are current.
    document.documentElement.dataset.skin = next
    try {
      localStorage.setItem(SKIN_STORAGE_KEY, next)
    } catch {
      // Storage can be blocked; the skin still applies for this page.
    }
    setSkinState(next)
  }, [])
  const value = React.useMemo(() => ({ skin, setSkin }), [skin, setSkin])
  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>
}

export function useSkin() {
  const context = React.useContext(SkinContext)
  if (!context) throw new Error("useSkin must be used within a SkinProvider.")
  return context
}

/** Dashboard grid gap in px for the current skin, e.g. react-grid-layout margin={[gap, gap]}. */
export function usePanelGap() {
  const { skin } = useSkin()
  return React.useMemo(
    () =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--panel-gap",
        ),
      ) || 0,
    // Recomputed when the skin changes; it is the only thing that changes --panel-gap.
    [skin],
  )
}
