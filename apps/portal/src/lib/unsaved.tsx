import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
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
})
export function UnsavedProvider({ children }: { children: ReactNode }) {
  const [dirty, updateDirty] = useState(false)
  const dirtyRef = useRef(false)
  const saveRef = useRef<(() => Promise<boolean>) | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const setSaveHandler = useCallback((save?: () => Promise<boolean>) => {
    saveRef.current = save
  }, [])
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value
    updateDirty(value)
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
    <DirtyContext.Provider value={{ dirty, setDirty, setSaveHandler }}>
      {children}
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
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
