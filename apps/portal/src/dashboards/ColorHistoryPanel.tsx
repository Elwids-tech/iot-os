import type { ComponentProps } from "react"
import { HistoryStatePanel } from "./StateHistoryPanel"

export default function ColorHistoryPanel(
  props: ComponentProps<typeof HistoryStatePanel>,
) {
  return <HistoryStatePanel {...props} colour />
}
