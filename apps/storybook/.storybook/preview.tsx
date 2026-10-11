import "@iot-os/ui/globals.css"

import type { Decorator, Preview } from "@storybook/react-vite"
import { MemoryRouter } from "react-router-dom"
import { PaletteProvider } from "@iot-os/ui/components/palette"
import { SkinProvider } from "@iot-os/ui/components/skin"
import { TooltipProvider } from "@iot-os/ui/components/tooltip"

/** Links need a router; the gallery uses an in-memory one. Mirrors the three <html> axes the apps pre-paint: light/dark, dark palette and skin. */
const withAppearance: Decorator = (Story, context) => {
  const { theme, palette, skin } = context.globals
  const html = document.documentElement
  html.classList.toggle("dark", theme === "dark")
  html.style.colorScheme = theme === "dark" ? "dark" : "light"
  html.dataset.palette = palette
  html.dataset.skin = skin
  return (
    <MemoryRouter>
      <PaletteProvider key={palette}>
        <SkinProvider key={skin}>
          <TooltipProvider>
            <div className="min-h-svh bg-background p-6 text-foreground">
              <Story />
            </div>
          </TooltipProvider>
        </SkinProvider>
      </PaletteProvider>
    </MemoryRouter>
  )
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Light or dark",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        dynamicTitle: true,
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
        ],
      },
    },
    palette: {
      description: "Dark palette",
      toolbar: {
        title: "Palette",
        icon: "paintbrush",
        dynamicTitle: true,
        items: [
          { value: "dusk", title: "Dusk" },
          { value: "ink", title: "Ink" },
        ],
      },
    },
    skin: {
      description: "Skin",
      toolbar: {
        title: "Skin",
        icon: "component",
        dynamicTitle: true,
        items: [
          { value: "console", title: "Console" },
          { value: "instrument", title: "Instrument" },
          { value: "flight-deck", title: "Flight deck" },
        ],
      },
    },
  },
  initialGlobals: { theme: "dark", palette: "dusk", skin: "console" },
  decorators: [withAppearance],
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    a11y: { test: "error" },
    options: {
      storySort: { order: ["Introduction", "Foundations", "Components", "Templates"] },
    },
  },
}

export default preview
