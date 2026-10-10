import { Route, Routes } from "react-router-dom"
import { DeviceDirectory } from "./DeviceDirectory"
import { DeviceWorkspace } from "./DeviceWorkspace"
import { DiscoveryPage } from "./DiscoveryPage"
import { GatewaysPage } from "./GatewaysPage"
import { DeviceOnboarding } from "./DeviceOnboarding"
import SitesPage from "./SitesPage"

export default function DeviceRoutes({
  page,
}: {
  page?: "discovery" | "gateways" | "sites"
}) {
  if (page === "discovery") return <DiscoveryPage />
  if (page === "sites") return <SitesPage />
  if (page === "gateways") return <GatewaysPage />
  return (
    <Routes>
      <Route index element={<DeviceDirectory />} />
      <Route path="onboard" element={<DeviceOnboarding />} />
      <Route path="onboard/:deviceUuid" element={<DeviceOnboarding />} />
      <Route path=":deviceUuid/:section?" element={<DeviceWorkspace />} />
    </Routes>
  )
}
