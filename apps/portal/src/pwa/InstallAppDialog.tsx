import { Button } from "@iot-os/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { EllipsisVerticalIcon, ShareIcon, SquarePlusIcon } from "lucide-react"

/**
 * How to install where the browser has no install prompt (spec 033, FR-010). On iPhone
 * and iPad it is Share → Add to Home Screen, and the installed app keeps its own
 * sign-in, separate from Safari's. Elsewhere it points to the browser's own menu.
 */
export function InstallAppDialog({
  open,
  onOpenChange,
  ios,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ios: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install the app</DialogTitle>
          <DialogDescription>
            {ios
              ? "Add it to your Home Screen to open it like any other app and to get alerts as notifications."
              : "Install it from your browser's menu to open it in its own window."}
          </DialogDescription>
        </DialogHeader>
        {ios ? (
          <ol className="flex flex-col gap-3 text-body">
            <li className="flex items-start gap-3">
              <Step number={1} />
              <span>
                Tap <ShareIcon aria-hidden="true" className="inline size-4 align-text-bottom" />{" "}
                <strong className="font-medium">Share</strong> in the browser's toolbar.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Step number={2} />
              <span>
                Scroll down and tap <SquarePlusIcon aria-hidden="true" className="inline size-4 align-text-bottom" />{" "}
                <strong className="font-medium">Add to Home Screen</strong>, then <strong className="font-medium">Add</strong>.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Step number={3} />
              <span>
                Open it from your Home Screen and sign in there once. The app keeps its own
                sign-in, separate from the browser's.
              </span>
            </li>
          </ol>
        ) : (
          <p className="text-body">
            Open the browser's menu <EllipsisVerticalIcon aria-hidden="true" className="inline size-4 align-text-bottom" />{" "}
            and choose <strong className="font-medium">Install app</strong> or{" "}
            <strong className="font-medium">Add to Home screen</strong>. In Safari on a Mac, choose{" "}
            <strong className="font-medium">File → Add to Dock</strong>. Some browsers can't install apps; Chrome and
            Edge can.
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Step({ number }: { number: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-meta font-medium"
    >
      {number}
    </span>
  )
}
