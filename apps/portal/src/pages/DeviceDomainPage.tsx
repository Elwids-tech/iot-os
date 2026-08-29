import type { Organization } from "@iot-os/api-client"
import { useOutletContext } from "react-router-dom"

export function DeviceDomainPage() {
  const organization = useOutletContext<Organization>()

  return (
    <main className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">{organization.name}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Device Domain</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          The fixed definition editor has been removed. Dynamic Device Profile, Native MQTT
          Binding, Gateway, and Gateway Route authoring will be built here against the canonical
          contract.
        </p>
      </div>
    </main>
  )
}
