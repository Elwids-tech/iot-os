import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useId,
  type ReactNode,
} from "react"
import { useBlocker } from "react-router-dom"
import { Button } from "@iot-os/ui/components/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@iot-os/ui/components/alert-dialog"
const DirtyContext = createContext({
  dirty: false,
  setDirty: (_dirty: boolean) => {},
  setSaveHandler: (_save?: () => Promise<boolean>) => {},
  setContribution: (_id: string, _dirty: boolean) => {},
})
export function UnsavedProvider({ children }: { children: ReactNode }) {
  const [dirty, updateDirty] = useState(false)
  const dirtyRef = useRef(false)
  const primaryDirty = useRef(false)
  const contributions = useRef(new Set<string>())
  const saveRef = useRef<(() => Promise<boolean>) | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const setSaveHandler = useCallback((save?: () => Promise<boolean>) => {
    saveRef.current = save
  }, [])
  const setDirty = useCallback((value: boolean) => {
    primaryDirty.current = value
    dirtyRef.current = value || contributions.current.size > 0
    updateDirty(dirtyRef.current)
  }, [])
  const setContribution = useCallback((id: string, value: boolean) => {
    if (value) contributions.current.add(id)
    else contributions.current.delete(id)
    dirtyRef.current = primaryDirty.current || contributions.current.size > 0
    updateDirty(dirtyRef.current)
  }, [])
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        !currentLocation.pathname.includes("/dashboards/")),
  )
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  return (
    <DirtyContext.Provider
      value={{ dirty, setDirty, setSaveHandler, setContribution }}
    >
      {children}
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent className="w-[calc(100%-2rem)] sm:max-w-md!">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes are only in this form. Save them first, or discard
              them to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {saveFailed && (
            <p role="alert" className="text-sm text-destructive">
              Saving did not complete. Keep editing to review the error; your
              draft is preserved.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={saving}
              onClick={() => {
                setSaveFailed(false)
                blocker.reset?.()
              }}
            >
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={() => {
                setDirty(false)
                blocker.proceed?.()
              }}
            >
              Discard and leave
            </AlertDialogAction>
            {saveRef.current && (
              <Button
                disabled={saving}
                onClick={async () => {
                  setSaving(true)
                  setSaveFailed(false)
                  try {
                    if (await saveRef.current?.()) {
                      setDirty(false)
                      blocker.proceed?.()
                    } else setSaveFailed(true)
                  } catch {
                    setSaveFailed(true)
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? "Saving…" : "Save and leave"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DirtyContext.Provider>
  )
}
export function useUnsaved(dirty: boolean, save?: () => Promise<boolean>) {
  const { setDirty, setSaveHandler } = useContext(DirtyContext)
  useEffect(() => {
    setSaveHandler(save)
    return () => setSaveHandler(undefined)
  }, [save, setSaveHandler])
  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
}
export const useDirtyContext = () => useContext(DirtyContext)

/** Independent embedded editors must not clear another form's unsaved flag or save action. */
export function useUnsavedContribution(dirty: boolean) {
  const id = useId()
  const { setContribution } = useContext(DirtyContext)
  useEffect(() => {
    setContribution(id, dirty)
    return () => setContribution(id, false)
  }, [id, dirty, setContribution])
}
