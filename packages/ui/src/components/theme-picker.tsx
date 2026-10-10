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
