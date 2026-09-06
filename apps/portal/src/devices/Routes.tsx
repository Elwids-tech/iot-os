import { Route, Routes } from "react-router-dom"
import { DeviceDirectory } from "./DeviceDirectory"
import { DeviceWorkspace } from "./DeviceWorkspace"
import { DiscoveryPage } from "./DiscoveryPage"
import { GatewaysPage } from "./GatewaysPage"

export default function DeviceRoutes({
  page,
}: {
  page?: "discovery" | "gateways"
}) {
  if (page === "discovery") return <DiscoveryPage />
  if (page === "gateways") return <GatewaysPage />
  return (
    <Routes>
      <Route index element={<DeviceDirectory />} />
      <Route path=":deviceUuid/:section?" element={<DeviceWorkspace />} />
    </Routes>
  )
}
