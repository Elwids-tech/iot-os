import { Route, Routes } from "react-router-dom"
import { NewTicketPage } from "./NewTicketPage"
import { SupportList } from "./SupportList"
import { TicketPage } from "./TicketPage"

/** Support tickets (spec 015): your tickets, a new one, and one ticket. */
export default function SupportRoutes() {
  return (
    <Routes>
      <Route index element={<SupportList />} />
      <Route path="new" element={<NewTicketPage />} />
      <Route path=":ticketUuid" element={<TicketPage />} />
    </Routes>
  )
}
