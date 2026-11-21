import { runtimeConfig } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { RouterProvider, createBrowserRouter } from "react-router-dom"
import { Toaster } from "@iot-os/ui/components/sonner"
import { SkinProvider } from "@iot-os/ui/components/skin"
import { PaletteProvider } from "@iot-os/ui/components/palette"
import { RouteError } from "@iot-os/ui/components/error-boundary"
import { reloadOnStaleChunks } from "@iot-os/ui/lib/stale-chunks"
import "@iot-os/ui/globals.css"
import { App } from "./App"
import { watchConnection } from "./pwa/connection"
import "./pwa/install"
import { UpdatePrompt } from "./pwa/UpdatePrompt"
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15000 },
    // An action made offline fails at once instead of waiting to be sent on reconnect:
    // nothing is queued (spec 033, FR-013).
    mutations: { retry: false, networkMode: "always" },
  },
})
reloadOnStaleChunks()
watchConnection()
document.querySelector('meta[name="build-id"]')?.setAttribute("content", __BUILD_ID__)
// The service worker exists only in production builds (vite.config.ts, src/sw.ts).
const installable = import.meta.env.PROD && "serviceWorker" in navigator
const router = createBrowserRouter([{ path: "*", element: <App />, errorElement: <RouteError /> }])
// An address that is not in use, or one that moved, shows the bootstrap's message and
// starts nothing (spec 036, src/lib/brand-bootstrap.js).
if (!(window as { __IOT_HALT__?: boolean }).__IOT_HALT__) createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {runtimeConfig("environment") === "staging" ? <Badge variant="warning" className="fixed bottom-2 left-2 pointer-events-none">Staging environment</Badge> : null}
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <SkinProvider>
        <PaletteProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
            <Toaster closeButton duration={2500} />
            {installable && <UpdatePrompt />}
          </QueryClientProvider>
        </PaletteProvider>
      </SkinProvider>
    </ThemeProvider>
  </StrictMode>,
)
