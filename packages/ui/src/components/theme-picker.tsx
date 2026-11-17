import * as React from "react"
import { useTheme } from "next-themes"
import { SunMoonIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@iot-os/ui/components/dropdown-menu"
import { isSkin, skins, useSkin } from "@iot-os/ui/components/skin"
import { isPalette, palettes, usePalette } from "@iot-os/ui/components/palette"
import { SegmentedControl, SegmentedControlItem } from "@iot-os/ui/components/segmented-control"

const themes = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
]

/** Theme, dark palette and skin radio groups, for use inside any DropdownMenuContent (user menu, ThemePicker). */
export function AppearanceMenuItems() {
  const { theme = "system", setTheme } = useTheme()
  const { skin, setSkin } = useSkin()
  const { palette, setPalette } = usePalette()
  return (
    <>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
        {themes.map((item) => (
          <DropdownMenuRadioItem value={item.value} key={item.value}>
            {item.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Dark palette</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={palette}
        onValueChange={(value) => {
          if (isPalette(value)) setPalette(value)
        }}
      >
        {palettes.map((item) => (
          <DropdownMenuRadioItem value={item.value} key={item.value}>
            <span className="flex flex-col">
              <span>{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.description}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Skin</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={skin}
        onValueChange={(value) => {
          if (isSkin(value)) setSkin(value)
        }}
      >
        {skins.map((item) => (
          <DropdownMenuRadioItem value={item.value} key={item.value}>
            {item.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}

export function ThemePicker() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Choose color theme">
          <SunMoonIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <AppearanceMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Theme, dark palette and skin as labelled segmented controls, for a Settings page. */
export function AppearanceSettings() {
  const { theme = "system", setTheme } = useTheme()
  const { skin, setSkin } = useSkin()
  const { palette, setPalette } = usePalette()
  const row = (label: string, description: string, control: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-3 last:border-0">
      <div className="flex min-w-0 flex-col">
        <span className="text-heading">{label}</span>
        <span className="text-meta text-muted-foreground">{description}</span>
      </div>
      {control}
    </div>
  )
  return (
    <div className="flex flex-col">
      {row(
        "Theme",
        "Light, dark, or follow this device.",
        <SegmentedControl aria-label="Theme" value={theme} onValueChange={(value) => value && setTheme(value)}>
          {themes.map((item) => (
            <SegmentedControlItem key={item.value} value={item.value} className="px-3">
              {item.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>,
      )}
      {row(
        "Dark palette",
        "Dusk is softer; Ink is pure black for OLED screens.",
        <SegmentedControl aria-label="Dark palette" value={palette} onValueChange={(value) => isPalette(value) && setPalette(value)}>
          {palettes.map((item) => (
            <SegmentedControlItem key={item.value} value={item.value} className="px-3">
              {item.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>,
      )}
      {row(
        "Skin",
        "Type, corners and density across the product.",
        <SegmentedControl aria-label="Skin" value={skin} onValueChange={(value) => isSkin(value) && setSkin(value)}>
          {skins.map((item) => (
            <SegmentedControlItem key={item.value} value={item.value} className="px-3">
              {item.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>,
      )}
    </div>
  )
}
