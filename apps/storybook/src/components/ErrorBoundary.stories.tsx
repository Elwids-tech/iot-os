import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@iot-os/ui/components/button"
import { ErrorBoundary, ErrorState } from "@iot-os/ui/components/error-boundary"

const meta: Meta<typeof ErrorState> = { title: "Components/ErrorState", component: ErrorState }
export default meta

/** A render error: Try again when the caller can retry, Reload, and the message under Technical details. */
export const PageError: StoryObj = {
  render: () => (
    <ErrorState error={new TypeError("Cannot read properties of null (reading 'map')")} onRetry={() => undefined} className="max-w-lg" />
  ),
}

/** A chunk from an older build failed to load after a deploy. The app reloads once by itself; this shows if that didn't help. */
export const NewVersion: StoryObj = {
  render: () => (
    <ErrorState error={new TypeError("Failed to fetch dynamically imported module: https://example.com/assets/Routes-abc.js")} className="max-w-lg" />
  ),
}

function Broken(): never {
  throw new Error("The panel's data had an unexpected shape")
}

/**
 * `ErrorBoundary` around a layout's page area: the page shows the error state,
 * the rest of the app keeps working, and Try again renders the page again.
 */
export const Boundary: StoryObj = {
  render: function Render() {
    const [broken, setBroken] = useState(false)
    return (
      <div className="flex min-h-80 max-w-xl flex-col gap-4">
        <Button variant="outline" className="self-start" onClick={() => setBroken(true)}>Break the page</Button>
        <ErrorBoundary
          resetKey={broken}
          fallback={({ error, reset }) => <ErrorState error={error} onRetry={() => { setBroken(false); reset() }} />}
        >
          {broken ? <Broken /> : <p className="text-body text-muted-foreground">The page renders here.</p>}
        </ErrorBoundary>
      </div>
    )
  },
}
