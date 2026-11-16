import { useState, useSyncExternalStore } from "react"
import { canPrompt, iosSafari, justInstalled, prompt, standalone, subscribeInstall } from "./install"
import { InstallAppDialog } from "./InstallAppDialog"

/**
 * **Install app** for the user menu (spec 033, FR-010): hidden inside the installed app
 * and once installed from this page; otherwise the browser's own prompt where there is
 * one, or the steps. Render `dialog` outside the menu, which unmounts when it closes.
 */
export function useInstallApp() {
  const promptable = useSyncExternalStore(subscribeInstall, canPrompt, () => false)
  const installed = useSyncExternalStore(subscribeInstall, justInstalled, () => false)
  const [steps, setSteps] = useState(false)
  const ios = iosSafari()
  return {
    visible: !installed && !standalone(),
    install: () => {
      if (promptable) void prompt()
      else setSteps(true)
    },
    dialog: <InstallAppDialog open={steps} onOpenChange={setSteps} ios={ios} />,
  }
}
