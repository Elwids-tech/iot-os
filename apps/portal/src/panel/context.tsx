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
 * for the current context, the other tabs hold the guides. Every assistant is a
 * conversation here, never a tab of its own page. Pages that own an
 * assistant (the automation editor) register a slot: a title for the context
 * line and a DOM target they portal their conversation into, so the
 * conversation keeps the page's state while living in the panel. Every page
 * opens Ask from the header; where no assistant belongs to the page, Ask
 * suggests the work it can do there and starts it.
 */

export type PanelTab = "ask" | "page" | "guides"

export type PanelSlot = {
  /** What the assistant is working on, shown in the panel header. */
  title: string
  description?: string
}

/**
 * What Ask shows. "auto" follows the page: its own assistant ("context"), the
 * profile assistant on profile pages, the onboarding assistant on Add device and
 * device adapter pages, otherwise the suggestions ("home"). "profile",
 * "onboarding" and "help" are open from any page.
 */
export type AskMode = "auto" | "home" | "context" | "profile" | "onboarding" | "help"

/** Work a suggestion hands to an assistant; that assistant takes it once, when it is showing. */
export type AssistantHandoff =
  | { to: "profile"; profile?: string }
  /** `fresh` starts a new onboarding conversation instead of continuing the open one. */
  | { to: "onboarding"; fresh?: boolean }
  /** `id` travels in the navigation state, so only the editor opened for it takes it. */
  | { to: "automation"; text: string; id: string }
  | { to: "help"; text: string }

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
  handoff: AssistantHandoff | null
  /** Opens Ask on the mode and leaves the work for its assistant. */
  startTask: (mode: AskMode, handoff?: AssistantHandoff) => void
  /** Clears the hand-off once its assistant has taken it. */
  takeHandoff: () => void
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
  const [askMode, setAskMode] = useState<AskMode>("auto")
  const [handoff, setHandoff] = useState<AssistantHandoff | null>(null)
  const [slot, setSlot] = useState<PanelSlot | null>(null)
  const [slotTarget, setSlotTarget] = useState<HTMLElement | null>(null)
  const value = useMemo<PanelContextValue>(
    () => ({
      open,
      tab,
      openPanel: (next = "ask") => {
        if (next === "ask") setAskMode("auto")
        setTab(next)
        setOpen(true)
      },
      closePanel: () => setOpen(false),
      togglePanel: (next) => {
        // The Assistant control closes the panel only when Ask already follows the page;
        // from another task it returns to the page's assistant or suggestions instead.
        if (open && tab === next && (next !== "ask" || askMode === "auto")) {
          setOpen(false)
          return
        }
        if (next === "ask") setAskMode("auto")
        setTab(next)
        setOpen(true)
      },
      setTab,
      askMode,
      setAskMode,
      handoff,
      startTask: (mode, next) => {
        setHandoff(next ?? null)
        setAskMode(mode)
        setTab("ask")
        setOpen(true)
      },
      takeHandoff: () => setHandoff(null),
      slot,
      setSlot,
      slotTarget,
      setSlotTarget,
    }),
    [open, tab, askMode, handoff, slot, slotTarget],
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
