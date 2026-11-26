import { Route, Routes } from "react-router-dom"
import HierarchyPage from "./HierarchyPage"
import EntityRecord from "./EntityPage"
import TypesTab from "./TypesTab"

/** Devices → Hierarchy (spec 009): the tree, its types, and one entity's page. */
export default function HierarchyRoutes() {
  return (
    <Routes>
      <Route index element={<HierarchyPage />} />
      <Route path="types" element={<TypesTab />} />
      <Route path=":entityUuid/:tab?" element={<EntityRecord />} />
    </Routes>
  )
}
