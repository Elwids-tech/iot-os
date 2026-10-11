import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

/*
 * One workspace panel for the whole portal: the Ask tab holds the assistant
 * for the current context, the other tabs hold the guides. Pages that own an
 * assistant (the automation editor) register a slot: a title for the context
 * line and a DOM target they portal their conversation into, so the
 * conversation keeps the page's state while living in the panel.
 */

export type PanelTab = "ask" | "page" | "guides"

export type PanelSlot = {
  /** What the assistant is working on, shown in the panel header. */
  title: string
  description?: string
}

/** With a page assistant present, Ask shows it ("context") or guide-based usage help ("help"). */
export type AskMode = "context" | "help"

export type PanelContextValue = {
  open: boolean
  tab: PanelTab
  /** Open on a tab (default Ask, which also returns Ask to the context assistant). */
  openPanel: (tab?: PanelTab) => void
  closePanel: () => void
  /** Open on the tab, or close when it is already open on that tab. */
  togglePanel: (tab: PanelTab) => void
  setTab: (tab: PanelTab) => void
  askMode: AskMode
  setAskMode: (mode: AskMode) => void
  slot: PanelSlot | null
  setSlot: (slot: PanelSlot | null) => void
  /** Where a slot owner portals its body; null until the panel has mounted. */
  slotTarget: HTMLElement | null
  setSlotTarget: (element: HTMLElement | null) => void
}

export const PanelContext = createContext<PanelContextValue | null>(null)

export function usePanel() {
  const context = useContext(PanelContext)
  if (!context) throw new Error("usePanel must be used within the portal shell.")
  return context
}

/** Hosts the panel state; the shell renders this around the page and the panel. */
export function PanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PanelTab>("page")
  const [askMode, setAskMode] = useState<AskMode>("context")
  const [slot, setSlot] = useState<PanelSlot | null>(null)
  const [slotTarget, setSlotTarget] = useState<HTMLElement | null>(null)
  const value = useMemo<PanelContextValue>(
    () => ({
      open,
      tab,
      openPanel: (next = "ask") => {
        if (next === "ask") setAskMode("context")
        setTab(next)
        setOpen(true)
      },
      closePanel: () => setOpen(false),
      togglePanel: (next) => {
        // The Assistant control closes the panel only when it already shows the context assistant;
        // from usage help it returns to the context assistant instead.
        if (open && tab === next && (next !== "ask" || askMode === "context")) {
          setOpen(false)
          return
        }
        if (next === "ask") setAskMode("context")
        setTab(next)
        setOpen(true)
      },
      setTab,
      askMode,
      setAskMode,
      slot,
      setSlot,
      slotTarget,
      setSlotTarget,
    }),
    [open, tab, askMode, slot, slotTarget],
  )
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
}

/**
 * Registers the page's assistant with the panel while the component is
 * mounted and returns the element to portal its body into. Only the title
 * and description are stored, so re-renders of the owner never loop.
 */
export function usePanelSlot(title: string, description?: string) {
  const { setSlot, slotTarget } = usePanel()
  useEffect(() => {
    setSlot({ title, description })
    return () => setSlot(null)
  }, [setSlot, title, description])
  return slotTarget
}
