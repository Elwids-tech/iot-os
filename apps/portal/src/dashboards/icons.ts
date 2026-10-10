import {
  ActivityIcon,
  BellIcon,
  ChartLineIcon,
  ChartNoAxesGanttIcon,
  GaugeIcon,
  MapPinIcon,
  PaletteIcon,
  Rows3Icon,
  SlidersHorizontalIcon,
  TableIcon,
  TypeIcon,
} from "lucide-react"
import type { DashboardWidget } from "@iot-os/api-client"

export const PANEL_ICONS: Record<DashboardWidget["type"], typeof GaugeIcon> = {
  status: Rows3Icon,
  gauge: GaugeIcon,
  table: TableIcon,
  controls: SlidersHorizontalIcon,
  device_health: ActivityIcon,
  timeseries: ChartLineIcon,
  state_history: ChartNoAxesGanttIcon,
  color_history: PaletteIcon,
  location: MapPinIcon,
  alerts: BellIcon,
  text: TypeIcon,
}
