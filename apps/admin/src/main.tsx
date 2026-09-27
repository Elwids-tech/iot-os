import { runtimeConfig } from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@iot-os/ui/globals.css"
import { ThemeProvider } from "next-themes"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {runtimeConfig("environment") === "staging" ? <Badge variant="warning" className="fixed bottom-2 left-2 pointer-events-none">Staging · test data</Badge> : null}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem><App /></ThemeProvider>
  </StrictMode>,
)
