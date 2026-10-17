import { useEffect, useState } from "react"
import type { AuthenticatedUser } from "@iot-os/api-client"
import { RouteError } from "@iot-os/ui/components/error-boundary"
import { Toaster } from "@iot-os/ui/components/sonner"
import { Navigate, Route, RouterProvider, Routes, createBrowserRouter } from "react-router-dom"
import { AcceptInvitationPage } from "./auth/AcceptInvitationPage"
import { AccessDeniedPage } from "./auth/AccessDeniedPage"
import { LoginPage } from "./auth/LoginPage"
import { AdminLayout } from "./layout/AdminLayout"
import { apiClient } from "./lib/api-client"
import { portalUrl } from "./lib/portal"
import { NewRolePage } from "./pages/NewRolePage"
import { OrganizationPermissionsPage } from "./pages/OrganizationPermissionsPage"
import { OrganizationsPage } from "./pages/OrganizationsPage"
import { RolePermissionsPage } from "./pages/RolePermissionsPage"
import { RolesPage } from "./pages/RolesPage"
import { UsersPage } from "./pages/UsersPage"
import { RetentionPage } from "./pages/RetentionPage"
import { AssistantPage } from "./pages/AssistantPage"

type ScreenState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthenticatedUser }

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

  if (!screen.user.capabilities.platform_administration) {
    return <AccessDeniedPage user={screen.user} onSignOut={signOut} />
  }

  return (
    <Routes>
      <Route element={<AdminLayout user={screen.user} onSignOut={signOut} />}>
        <Route index element={<Navigate to="/organizations" replace />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="organizations/:organizationUuid/permissions" element={<OrganizationPermissionsPage />} />
        <Route path="users" element={<UsersPage currentUser={screen.user} />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="roles/new" element={<NewRolePage />} />
        <Route path="roles/:roleId" element={<RolePermissionsPage />} />
        <Route path="device-profiles" element={<TenantPortalRedirect />} />
        {screen.user.capabilities.manage_retention ? (
          <Route path="settings/retention" element={<RetentionPage />} />
        ) : null}
        {screen.user.capabilities.manage_assistant ? (
          <Route path="settings/assistant" element={<AssistantPage />} />
        ) : null}
        <Route path="*" element={<Navigate to="/organizations" replace />} />
      </Route>
    </Routes>
  )
}

function TenantPortalRedirect() {
  useEffect(() => window.location.replace(portalUrl), [])
  return <p>Opening tenant portal…</p>
}
