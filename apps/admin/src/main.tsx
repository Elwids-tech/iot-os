import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@iot-os/ui/globals.css"
import { ThemeProvider } from "next-themes"
import { SkinProvider } from "@iot-os/ui/components/skin"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <SkinProvider>
        <App />
      </SkinProvider>
    </ThemeProvider>
  </StrictMode>,
)
