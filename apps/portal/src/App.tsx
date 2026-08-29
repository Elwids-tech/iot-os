import { useEffect, useState } from "react"
import type { AuthenticatedUser, Organization } from "@iot-os/api-client"
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card"
import { Building2Icon } from "lucide-react"
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useParams,
} from "react-router-dom"
import { LoginPage } from "./auth/LoginPage"
import { PortalLayout } from "./layout/PortalLayout"
import { apiClient } from "./lib/api-client"
import { DeviceDomainPage } from "./pages/DeviceDomainPage"

type ScreenState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthenticatedUser }

function OrganizationBoundary({ user }: { user: AuthenticatedUser }) {
  const { organizationUuid } = useParams()
  const organization = user.organizations.find((item) => item.uuid === organizationUuid)
  const [readyOrganizationUuid, setReadyOrganizationUuid] = useState<string | null>(() =>
    apiClient.getSelectedOrganizationUuid(),
  )

  useEffect(() => {
    if (!organization) return

    apiClient.setSelectedOrganizationUuid(organization.uuid)
    setReadyOrganizationUuid(organization.uuid)
  }, [organization])

  if (!organization) {
    const fallback = user.organizations[0]

    return (
      <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Organization access changed</CardTitle>
            <CardDescription>
              This workspace is unavailable or is no longer part of your memberships.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Alert>
              <Building2Icon />
              <AlertTitle>Select an available Organization</AlertTitle>
              <AlertDescription>
                Your URL was preserved so you can safely return after access is restored.
              </AlertDescription>
            </Alert>
            {fallback ? (
              <Button asChild>
                <a href={`/organizations/${fallback.uuid}/device-domain`}>Open {fallback.name}</a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </main>
    )
  }

  if (readyOrganizationUuid !== organization.uuid) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Opening {organization.name}…
      </main>
    )
  }

  return <Outlet context={organization} />
}

function TenantPortalApp() {
  const [screen, setScreen] = useState<ScreenState>({ status: "loading" })

  function showAuthenticatedUser(user: AuthenticatedUser) {
    const selectedUuid = apiClient.getSelectedOrganizationUuid()
    const selected = user.organizations.find((organization) => organization.uuid === selectedUuid)
    apiClient.setSelectedOrganizationUuid(selected?.uuid ?? user.organizations[0]?.uuid ?? null)
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
        Loading tenant workspace…
      </main>
    )
  }

  if (screen.status === "signed-out") {
    return <LoginPage onAuthenticated={showAuthenticatedUser} />
  }

  if (screen.user.organizations.length === 0) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>No tenant workspace available</CardTitle>
            <CardDescription>
              Your account is valid but does not currently belong to an Organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const fallbackUuid =
    screen.user.organizations.find(
      (organization) => organization.uuid === apiClient.getSelectedOrganizationUuid(),
    )?.uuid ?? screen.user.organizations[0].uuid

  return (
    <Routes>
      <Route
        path="organizations/:organizationUuid"
        element={<OrganizationBoundary user={screen.user} />}
      >
        <Route element={<PortalLayout user={screen.user} onSignOut={signOut} />}>
          <Route index element={<Navigate to="device-domain" replace />} />
          <Route path="device-domain" element={<DeviceDomainPage />} />
        </Route>
      </Route>
      <Route
        path="*"
        element={<Navigate to={`/organizations/${fallbackUuid}/device-domain`} replace />}
      />
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <TenantPortalApp />
    </BrowserRouter>
  )
}

export type PortalOutletContext = Organization
