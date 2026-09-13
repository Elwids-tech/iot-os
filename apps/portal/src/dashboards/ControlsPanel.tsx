import { DeviceControls } from "../controls/DeviceControls"
import { useDeviceOrganization } from "../devices/shared"
import type { PanelProps } from "./registry"

export function ControlsPanel({ org, widget, preview }: PanelProps) {
  const { capabilities } = useDeviceOrganization()
  if (!widget.config.sources.length)
    return (
      <p className="text-sm text-muted-foreground">
        Add writable parameters to preview controls.
      </p>
    )
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {widget.config.sources.map((source) => (
        <section
          key={`${source.device_uuid}:${source.parameter_uuid}`}
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-medium">
            {source.device_name ?? "Device"}
          </h3>
          <DeviceControls
            org={org}
            deviceUuid={source.device_uuid}
            allowed={capabilities.command}
            preview={preview}
            sources={[source]}
          />
        </section>
      ))}
    </div>
  )
}
