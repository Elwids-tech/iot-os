import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog"
import { Button } from "@iot-os/ui/components/button"
import { useBlocker } from "react-router-dom"

/**
 * Asks before unsaved edits are lost: on route changes (router blocker), tab close
 * (beforeunload) and in-page switches wrapped with `guard(action)`. Render `dialog`.
 */
export function useDiscardGuard(dirty: boolean, copy: { title: string; description: string }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  const [pending, setPending] = useState<(() => void) | null>(null)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function guard(action: () => void) {
    if (dirty) setPending(() => action)
    else action()
  }

  function keepEditing() {
    setPending(null)
    if (blocker.state === "blocked") blocker.reset()
  }

  function discard() {
    const action = pending
    setPending(null)
    if (action) action()
    else if (blocker.state === "blocked") blocker.proceed()
  }

  const dialog = (
    <AlertDialog
      open={pending !== null || blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open) keepEditing()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <Button variant="destructive" onClick={discard}>
            Discard changes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { guard, dialog }
}
