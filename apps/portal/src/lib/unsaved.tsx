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
})
export function UnsavedProvider({ children }: { children: ReactNode }) {
  const [dirty, updateDirty] = useState(false)
  const dirtyRef = useRef(false)
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value
    updateDirty(value)
  }, [])
  const blocker = useBlocker(() => dirtyRef.current)
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
    <DirtyContext.Provider value={{ dirty, setDirty }}>
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
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDirty(false)
                blocker.proceed?.()
              }}
            >
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DirtyContext.Provider>
  )
}
export function useUnsaved(dirty: boolean) {
  const { setDirty } = useContext(DirtyContext)
  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
}
export const useDirtyContext = () => useContext(DirtyContext)
