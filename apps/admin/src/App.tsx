import { useEffect, useState } from "react"
import type { AuthenticatedUser } from "@iot-os/api-client"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AcceptInvitationPage } from "./auth/AcceptInvitationPage"
import { AccessDeniedPage } from "./auth/AccessDeniedPage"
import { LoginPage } from "./auth/LoginPage"
import { AdminLayout } from "./layout/AdminLayout"
import { apiClient } from "./lib/api-client"
import { OrganizationsPage } from "./pages/OrganizationsPage"
import { RolePermissionsPage } from "./pages/RolePermissionsPage"
import { RolesPage } from "./pages/RolesPage"
import { UsersPage } from "./pages/UsersPage"
import { RetentionPage } from "./pages/RetentionPage"


type ScreenState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthenticatedUser }

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="*" element={<PlatformAdministrationApp />} />
      </Routes>
    </BrowserRouter>
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
        <Route path="users" element={<UsersPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="roles/:roleId" element={<RolePermissionsPage />} />
        <Route path="device-profiles" element={<TenantPortalRedirect />} />
        <Route path="settings/retention" element={screen.user.capabilities.manage_retention ? <RetentionPage /> : <AccessDeniedPage user={screen.user} onSignOut={signOut} />} />
        <Route path="*" element={<Navigate to="/organizations" replace />} />
      </Route>
    </Routes>
  )
}

function TenantPortalRedirect() {
  useEffect(() => { window.location.replace(import.meta.env.VITE_PORTAL_URL || `${window.location.protocol}//${window.location.hostname}:5173`) }, [])
  return <p>Opening tenant portal…</p>
}
