import { lazy, Suspense, useEffect, useState } from "react"
import type { AuthenticatedUser } from "@iot-os/api-client"
import { RouteError } from "@iot-os/ui/components/error-boundary"
import { Toaster } from "@iot-os/ui/components/sonner"
import { Navigate, Route, RouterProvider, Routes, createBrowserRouter } from "react-router-dom"
import { AcceptInvitationPage } from "./auth/AcceptInvitationPage"
import { AccessDeniedPage } from "./auth/AccessDeniedPage"
import { LoginPage } from "./auth/LoginPage"
import { AdminLayout } from "./layout/AdminLayout"
import { homePath } from "./lib/access"
import { apiClient } from "./lib/api-client"
import { portalUrl } from "./lib/portal"
import { ActivityPage } from "./pages/ActivityPage"
import { NewRolePage } from "./pages/NewRolePage"
import { BillingAccountPage } from "./pages/BillingAccountPage"
import { BillingAccountsPage } from "./pages/BillingAccountsPage"
import { BillingSettingsPage } from "./pages/BillingSettingsPage"
import { InvoicePage } from "./pages/InvoicePage"
import { InvoicesPage } from "./pages/InvoicesPage"
import { OrganizationPermissionsPage } from "./pages/OrganizationPermissionsPage"
import { OrganizationsPage } from "./pages/OrganizationsPage"
import { OrganizationStreamsPage } from "./pages/OrganizationStreamsPage"
import { PlanPage } from "./pages/PlanPage"
import { PlansPage } from "./pages/PlansPage"
import { RolePermissionsPage } from "./pages/RolePermissionsPage"
import { RolesPage } from "./pages/RolesPage"
import { UsersPage } from "./pages/UsersPage"
import { RetentionPage } from "./pages/RetentionPage"
import { AssistantPage } from "./pages/AssistantPage"

type ScreenState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthenticatedUser }

// The ticket queue carries the rich text editor, so it loads when first opened.
const TicketsPage = lazy(() => import("./pages/TicketsPage").then((module) => ({ default: module.TicketsPage })))
const ticketsPage = (
  <Suspense fallback={<p className="p-6 text-body text-muted-foreground">Loading tickets…</p>}>
    <TicketsPage />
  </Suspense>
)

// A data router so pages can block navigation with useBlocker.
const router = createBrowserRouter([
  {
    path: "*",
    errorElement: <RouteError />,
    element: (
      <Routes>
        <Route path="accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="*" element={<PlatformAdministrationApp />} />
      </Routes>
    ),
  },
])

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster closeButton duration={2500} />
    </>
  )
}

function PlatformAdministrationApp() {
  const [screen, setScreen] = useState<ScreenState>({ status: "loading" })

  function showAuthenticatedUser(user: AuthenticatedUser) {
    apiClient.setSelectedOrganizationUuid(null)
    setScreen({ status: "signed-in", user })
  }

  async function signOut() {
    try {
      await apiClient.logout()
    } finally {
      apiClient.setSelectedOrganizationUuid(null)
      setScreen({ status: "signed-out" })
    }
  }

  useEffect(() => {
    let active = true

    apiClient
      .me()
      .then((user) => {
        if (active) showAuthenticatedUser(user)
      })
      .catch(() => {
        if (active) setScreen({ status: "signed-out" })
      })

    return () => {
      active = false
    }
  }, [])

  if (screen.status === "loading") {
    return (
      <main
        className="flex min-h-svh items-center justify-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        Loading administration…
      </main>
    )
  }

  if (screen.status === "signed-out") {
    return <LoginPage onAuthenticated={showAuthenticatedUser} />
  }

  const home = homePath(screen.user)
  if (!screen.user.capabilities.platform_administration || home === null) {
    return <AccessDeniedPage user={screen.user} onSignOut={signOut} />
  }
  const organizations = Boolean(screen.user.capabilities.manage_organizations)

  return (
    <Routes>
      <Route element={<AdminLayout user={screen.user} onSignOut={signOut} />}>
        <Route index element={<Navigate to={home} replace />} />
        {/* Their API needs manage-organizations (lib/access.ts). */}
        {organizations ? (
          <>
            <Route path="organizations" element={<OrganizationsPage />} />
            <Route path="organizations/:organizationUuid/permissions" element={<OrganizationPermissionsPage />} />
            <Route path="organizations/:organizationUuid/streams" element={<OrganizationStreamsPage />} />
            <Route path="billing-accounts" element={<BillingAccountsPage />} />
            <Route path="billing-accounts/:billingAccountUuid" element={<BillingAccountPage />} />
            <Route path="plans" element={<PlansPage />} />
            <Route path="plans/:planUuid" element={<PlanPage />} />
            <Route path="billing/invoices" element={<InvoicesPage />} />
            <Route path="billing/invoices/:invoiceUuid" element={<InvoicePage />} />
            <Route path="settings/billing" element={<BillingSettingsPage />} />
            <Route path="users" element={<UsersPage currentUser={screen.user} />} />
            <Route path="roles" element={<RolesPage />} />
            <Route path="roles/new" element={<NewRolePage />} />
            <Route path="roles/:roleId" element={<RolePermissionsPage />} />
            <Route path="activity" element={<ActivityPage />} />
          </>
        ) : null}
        <Route path="device-profiles" element={<TenantPortalRedirect />} />
        {screen.user.capabilities.manage_retention ? (
          <Route path="settings/retention" element={<RetentionPage />} />
        ) : null}
        {screen.user.capabilities.manage_assistant ? (
          <Route path="settings/assistant" element={<AssistantPage />} />
        ) : null}
        {screen.user.capabilities.manage_tickets ? (
          <>
            <Route path="tickets" element={ticketsPage} />
            <Route path="tickets/:ticketUuid" element={ticketsPage} />
          </>
        ) : null}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  )
}

function TenantPortalRedirect() {
  useEffect(() => window.location.replace(portalUrl), [])
  return <p>Opening tenant portal…</p>
}
