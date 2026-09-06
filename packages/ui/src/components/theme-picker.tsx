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
} from "@iot-os/ui/components/dropdown-menu"
export function ThemePicker() {
  const { theme = "system", setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Choose color theme">
          <SunMoonIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {["light", "dark", "system"].map((value) => (
            <DropdownMenuRadioItem value={value} key={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
