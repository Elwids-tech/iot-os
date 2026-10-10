import { Link, useSearchParams } from "react-router-dom"
import type { DeviceProfile } from "@iot-os/api-client"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import { CheckCircle2Icon, CpuIcon } from "lucide-react"
import { safeReturnTo, withParam, withReturnTo } from "./return-to"

/** The validated way back to device setup, and a helper that keeps it on in-studio links. */
export function useReturnTo() {
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get("returnTo"), window.location.origin)
  return {
    returnTo,
    keep: (path: string) => withReturnTo(path, returnTo),
  }
}

/**
 * Shown while a device setup waits for a published profile. Once the profile has a live
 * version with nothing left to publish, the way back becomes the primary action and
 * preselects this profile.
 */
export function DeviceSetupBanner({
  returnTo,
  profile,
}: {
  returnTo: string
  profile?: DeviceProfile
}) {
  const live = profile && profile.revision > 0 && profile.status === "published"
  const back =
    profile && profile.revision > 0
      ? withParam(returnTo, "profile", profile.uuid)
      : returnTo
  return (
    <div className="px-4 pt-4 md:px-6">
      <Alert
        className={
          "flex flex-wrap items-center gap-x-4 gap-y-2" +
          (live ? " border-success/40" : "")
        }
      >
        {live ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-success" />
        ) : (
          <CpuIcon className="size-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <AlertTitle>
            {live
              ? `Version ${profile.revision} is live`
              : "Setting up a device"}
          </AlertTitle>
          <AlertDescription>
            {live
              ? "Return to device setup to use this profile."
              : profile
                ? "Publish this profile, then return to device setup."
                : "Create or open a profile and publish it, then return to device setup."}
          </AlertDescription>
        </div>
        <Button asChild size="sm" variant={live ? "default" : "outline"}>
          <Link to={back}>Back to device setup</Link>
        </Button>
      </Alert>
    </div>
  )
}
