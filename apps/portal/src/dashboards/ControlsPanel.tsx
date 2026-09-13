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
  const groups = Array.from(
    widget.config.sources.reduce((devices, source) => {
      const group = devices.get(source.device_uuid)
      if (group) group.push(source)
      else devices.set(source.device_uuid, [source])
      return devices
    }, new Map<string, typeof widget.config.sources>()),
  )
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      {groups.map(([deviceUuid, sources]) => (
        <section key={deviceUuid} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {sources[0]?.device_name ?? "Device"}
          </h3>
          <DeviceControls
            org={org}
            deviceUuid={deviceUuid}
            allowed={capabilities.command}
            preview={preview}
            sources={sources}
            columns={widget.config.columns}
          />
        </section>
      ))}
    </div>
  )
}
