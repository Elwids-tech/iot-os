import { Route, Routes } from "react-router-dom"
import { DeviceDirectory } from "./DeviceDirectory"
import { DeviceWorkspace } from "./DeviceWorkspace"
import { DiscoveryPage } from "./DiscoveryPage"
import { GatewaysPage } from "./GatewaysPage"
import { GatewayPage } from "./GatewayPage"
import { ConnectionsPage } from "./ConnectionsPage"
import { DeviceOnboarding } from "./DeviceOnboarding"

export default function DeviceRoutes({
  page,
}: {
  page?: "discovery" | "gateways" | "connections"
}) {
  if (page === "discovery") return <DiscoveryPage />
  if (page === "connections") return <ConnectionsPage />
  if (page === "gateways")
    return (
      <Routes>
        <Route index element={<GatewaysPage />} />
        <Route path=":gatewayUuid" element={<GatewayPage />} />
      </Routes>
    )
  return (
    <Routes>
      <Route index element={<DeviceDirectory />} />
      <Route path="onboard" element={<DeviceOnboarding />} />
      <Route path="onboard/:deviceUuid" element={<DeviceOnboarding />} />
      <Route path=":deviceUuid/:section?" element={<DeviceWorkspace />} />
    </Routes>
  )
}
