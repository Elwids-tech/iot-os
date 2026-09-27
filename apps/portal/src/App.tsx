import { lazy, Suspense, useEffect, useState } from "react"
import { ApiError, type Organization } from "@iot-os/api-client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Routes,
  Route,
  Navigate,
  Outlet,
  Link,
  useNavigate,
  useLocation,
  useParams,
  NavLink,
} from "react-router-dom"
import { useForm } from "react-hook-form"
import { AcceptInvitationPage } from "@iot-os/auth/AcceptInvitationPage"
import { Button } from "@iot-os/ui/components/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@iot-os/ui/components/card"
import { FieldGroup } from "@iot-os/ui/components/field"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { ThemePicker } from "@iot-os/ui/components/theme-picker"
import { Separator } from "@iot-os/ui/components/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@iot-os/ui/components/sidebar"
import { TooltipProvider } from "@iot-os/ui/components/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@iot-os/ui/components/dialog"
import {
  CpuIcon,
  PlugIcon,
  BellRingIcon,
  LogOutIcon,
  ArrowRightIcon,
  Building2Icon,
  ChevronsUpDownIcon,
  FileCogIcon,
  HardDriveIcon,
  LayoutDashboardIcon,
  MapPinnedIcon,
  RadarIcon,
  RouterIcon,
  SparklesIcon,
} from "lucide-react"
import { api } from "./lib/api"
import { UnsavedProvider, useDirtyContext } from "./lib/unsaved"
import { TextField, RequestError, Confirm } from "./components/forms"
import { ProfileDirectory } from "./profiles/ProfileDirectory"
const DashboardPage = lazy(() => import("./dashboards/DashboardPage").then(module => ({ default: module.DashboardPage })))
const DeviceRoutes = lazy(() => import("./devices/Routes"))
const IntegrationRoutes = lazy(() => import("./integrations/Integrations"))
const AlertRoutes = lazy(() => import("./alerts/Alerts"))
const GeofenceRoutes = lazy(() => import("./geospatial/Geofences"))
const AssistantPanel = lazy(() => import("./assistant/AssistantPanel"))
const ProfileWorkspace = lazy(() =>
  import("./profiles/ProfileWorkspace").then((module) => ({
    default: module.ProfileWorkspace,
  })),
)
export function App() {
  return (
    <UnsavedProvider>
      <Routes>
        <Route
          path="accept-invitation"
          element={<AcceptInvitationPage apiClient={api} />}
        />
        <Route path="*" element={<Session />} />
      </Routes>
    </UnsavedProvider>
  )
}
function Login({ recovered = false }: { recovered?: boolean }) {
  const cache = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const form = useForm({ defaultValues: { email: "", password: "" } })
  return (
    <main className="flex min-h-svh items-center justify-center p-5">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-4 flex items-center justify-between">
            <CpuIcon className="text-primary" />
            <ThemePicker />
          </div>
          <CardTitle>
            <h1>Welcome to your workspace</h1>
          </CardTitle>
          <CardDescription>
            {recovered
              ? "Your session expired. Sign in to reopen this workspace."
              : "Sign in to build and manage your organization's device profiles."}
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            setError(null)
            try {
              const user = await api.login(values)
              cache.removeQueries({
                predicate: (query) => query.queryKey[0] !== "session",
              })
              cache.setQueryData(["session"], user)
            } catch (reason) {
              setError(reason)
            }
          })}
        >
          <CardContent>
            <FieldGroup>
              <TextField
                label="Email address"
                type="email"
                autoComplete="username"
                required
                {...form.register("email")}
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                {...form.register("password")}
              />
              <RequestError error={error} />
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
function Session() {
  const cache = useQueryClient()
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const expire = () => setExpired(true)
    window.addEventListener("iot-session-expired", expire)
    return () => window.removeEventListener("iot-session-expired", expire)
  }, [])
  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: 60000,
  })
  if (query.isPending)
    return (
      <main
        className="mx-auto flex max-w-4xl flex-col gap-5 p-8"
        aria-label="Loading workspace"
      >
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    )
  if (query.error instanceof ApiError && query.error.status === 401)
    return <Login />
  if (query.error)
    return (
      <main className="mx-auto max-w-lg p-8">
        <RequestError error={query.error} />
        <Button variant="outline" onClick={() => query.refetch()}>
          Retry connection
        </Button>
      </main>
    )
  const user = query.data!
  return (
    <>
      <Routes>
        <Route
          element={
            <PortalShell organizations={user.organizations} name={user.name} />
          }
        >
          <Route path="organizations/:organizationUuid/devices/*" element={<Suspense fallback={<Skeleton className="h-80 w-full" />}><DeviceRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/integrations/*" element={<Suspense fallback={<Skeleton className="h-80 w-full" />}><IntegrationRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/alerts/*" element={<Suspense fallback={<Skeleton className="h-80 w-full" />}><AlertRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/geofences/*" element={<Suspense fallback={<Skeleton className="h-80 w-full" />}><GeofenceRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/discovery" element={<Suspense fallback={<Skeleton className="h-80 w-full" />}><DeviceRoutes page="discovery" /></Suspense>} />
          <Route path="organizations/:organizationUuid/gateways" element={<Suspense fallback={<Skeleton className="h-80 w-full" />}><DeviceRoutes page="gateways" /></Suspense>} />
          <Route path="organizations/:organizationUuid/dashboards/:dashboardUuid?" element={<DashboardRoute />} />
          <Route
            path="organizations/:organizationUuid/device-profiles"
            element={<ProfileDirectory />}
          />
          <Route
            path="organizations/:organizationUuid/device-profiles/:profileUuid/:section?"
            element={
              <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                <ProfileWorkspace />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={<OrganizationLanding organizations={user.organizations} />}
          />
        </Route>
      </Routes>
      {expired && (
        <SessionRecovery
          email={user.email}
          onRecovered={async () => {
            setExpired(false)
            window.dispatchEvent(new Event("iot-session-restored"))
            await cache.invalidateQueries({ predicate: query => ["assistant-settings", "assistant-conversations"].includes(String(query.queryKey[0])) })
            await cache.invalidateQueries({ queryKey: ["organization"] })
            await cache.invalidateQueries({ queryKey: ["profile"] })
            await cache.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("device") || ["discovery", "gateways", "connections"].includes(String(query.queryKey[0])) })
          }}
        />
      )}
    </>
  )
}
function OrganizationLanding({
  organizations,
}: {
  organizations: Organization[]
}) {
  const selected =
    organizations.find(
      (item) => item.uuid === api.getSelectedOrganizationUuid(),
    ) ?? (organizations.length === 1 ? organizations[0] : null)
  if (selected)
    return <Navigate to={profileDirectoryPath(selected.uuid)} replace />
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-8">
      <h1 className="text-2xl font-semibold">Choose your organization</h1>
      <p className="text-muted-foreground">
        {organizations.length
          ? "Device profiles belong to an organization. Choose where you want to work."
          : "You do not belong to an organization yet. Ask your organization administrator for an invitation."}
      </p>
      {organizations.map((org) => (
        <Card key={org.uuid}>
          <CardHeader>
            <CardTitle>{org.name}</CardTitle>
            <CardDescription>{org.slug}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link to={profileDirectoryPath(org.uuid)}>
                Open workspace
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

function DashboardRoute() {
  const { organizationUuid, dashboardUuid } = useParams()
  return organizationUuid ? <Suspense fallback={<Skeleton className="h-80 w-full" />}><DashboardPage org={organizationUuid} id={dashboardUuid} /></Suspense> : null
}
export const profileDirectoryPath = (uuid: string) =>
  "/organizations/" + encodeURIComponent(uuid) + "/device-profiles"

const portalNavigation = [
  { path: "dashboards", label: "Dashboards", icon: LayoutDashboardIcon },
  { path: "devices", label: "Devices", icon: HardDriveIcon },
  { path: "integrations", label: "Integrations", icon: PlugIcon },
  { path: "alerts", label: "Alerts", icon: BellRingIcon },
  { path: "geofences", label: "Geofences", icon: MapPinnedIcon },
  { path: "discovery", label: "Discovery", icon: RadarIcon },
  { path: "gateways", label: "Gateways", icon: RouterIcon },
  { path: "device-profiles", label: "Device profiles", icon: FileCogIcon },
]

function PortalSidebar({
  organizations,
  organization,
  onOrganization,
}: {
  organizations: Organization[]
  organization?: Organization
  onOrganization: (uuid: string) => void
}) {
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  const closeMobile = () => setOpenMobile(false)

  return (
    <Sidebar collapsible="icon">
      <nav aria-label="Workspace" className="flex h-full flex-col">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                asChild
                tooltip="IoT OS Tenant portal"
              >
                <Link
                  to={
                    organization ? profileDirectoryPath(organization.uuid) : "/"
                  }
                  onClick={closeMobile}
                >
                  <CpuIcon />
                  <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:sr-only">
                    <span className="truncate font-semibold">IoT OS</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Tenant portal
                    </span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    tooltip="Change organization"
                    aria-label="Organization"
                  >
                    <Building2Icon />
                    <span className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:sr-only">
                      <span className="truncate text-xs text-muted-foreground">
                        Organization
                      </span>
                      <span className="truncate font-medium">
                        {organization?.name ?? "Choose organization"}
                      </span>
                    </span>
                    <ChevronsUpDownIcon className="ml-auto group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  className="w-64"
                >
                  {organizations.map((item) => (
                    <DropdownMenuItem
                      key={item.uuid}
                      onSelect={() => {
                        onOrganization(item.uuid)
                        closeMobile()
                      }}
                    >
                      <Building2Icon />
                      <span className="truncate">{item.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {organization && (
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {portalNavigation.map((item) => {
                    const to = `/organizations/${organization.uuid}/${item.path}`
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          asChild
                          tooltip={item.label}
                          isActive={location.pathname === to || location.pathname.startsWith(`${to}/`)}
                        >
                          <NavLink to={to} onClick={closeMobile}>
                            <item.icon />
                            <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <Building2Icon className="size-4 shrink-0" />
            <p>Define once. Connect through any protocol.</p>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </nav>
    </Sidebar>
  )
}

function PortalShell({
  organizations,
  name,
}: {
  organizations: Organization[]
  name: string
}) {
  const params = useParams()
  const org = organizations.find(
    (item) => item.uuid === params.organizationUuid,
  )
  const navigate = useNavigate()
  const location = useLocation()
  const cache = useQueryClient()
  const { dirty, setDirty } = useDirtyContext()
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantLoaded, setAssistantLoaded] = useState(false)
  const [logoutError, setLogoutError] = useState<unknown>(null)
  async function logout() {
    try {
      await api.logout()
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        setLogoutError(error)
        throw error
      }
    }
    api.setSelectedOrganizationUuid(null)
    setDirty(false)
    cache.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    })
    await cache.resetQueries({ queryKey: ["session"] })
    navigate("/", { replace: true })
  }
  useEffect(() => {
    if (org) api.setSelectedOrganizationUuid(org.uuid)
  }, [org?.uuid])
  const currentSection =
    portalNavigation.find((item) => location.pathname.includes(`/${item.path}`))
      ?.label ?? "Tenant portal"

  return (
    <TooltipProvider>
      <SidebarProvider>
        <PortalSidebar
          organizations={organizations}
          organization={org}
          onOrganization={(uuid) => navigate(profileDirectoryPath(uuid))}
        />
        <SidebarInset
          className={assistantOpen && org ? "md:pr-[440px]" : undefined}
        >
          <header className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b bg-card px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <span className="truncate text-sm font-medium">
              {currentSection}
            </span>
            <div
              id="dashboard-header-time-controls"
              className="ml-auto hidden min-w-0 items-center xl:flex"
            />
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {name}
              </span>
              <ThemePicker />
              {org && (
                <Button
                  variant="outline"
                  aria-label="Assistant"
                  aria-expanded={assistantOpen}
                  onClick={() => {
                    setAssistantLoaded(true)
                    setAssistantOpen((current) => !current)
                  }}
                >
                  <SparklesIcon data-icon="inline-start" />
                  <span className="hidden sm:inline">Assistant</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sign out"
                onClick={() =>
                  dirty ? setLogoutConfirm(true) : void logout().catch(() => {})
                }
              >
                <LogOutIcon />
              </Button>
            </div>
          </header>
          <div className="w-full min-w-0 flex-1 p-4 md:p-8">
            <RequestError error={logoutError} />
            {params.organizationUuid && !org ? (
              <Card>
                <CardHeader>
                  <CardTitle>Workspace unavailable</CardTitle>
                  <CardDescription>
                    You do not have access to this organization. Choose one of
                    your workspaces.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <Outlet />
            )}
          </div>
        </SidebarInset>
        {org && assistantLoaded && (
          <Suspense fallback={null}>
            <AssistantPanel
              key={org.uuid}
              org={org.uuid}
              organizationName={org.name}
              viewedProfile={params.profileUuid}
              open={assistantOpen}
              onClose={() => setAssistantOpen(false)}
            />
          </Suspense>
        )}
        <Confirm
          open={logoutConfirm}
          title="Sign out without saving?"
          description="Unsaved form changes will be discarded."
          action="Sign out"
          onClose={() => setLogoutConfirm(false)}
          onConfirm={logout}
        />
      </SidebarProvider>
    </TooltipProvider>
  )
}

function SessionRecovery({
  email,
  onRecovered,
}: {
  email: string
  onRecovered: () => Promise<void>
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false)
  return (
    <Dialog open>
      <DialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Restore your session</DialogTitle>
          <DialogDescription>
            Your unsaved form is still here. Sign in again as {email} to
            continue. The latest server revision will be checked before saving.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError(null)
            try {
              await api.login({ email, password })
              await onRecovered()
            } catch (reason) {
              setError(reason)
            } finally {
              setBusy(false)
            }
          }}
        >
          <FieldGroup>
            <TextField
              label="Session password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <RequestError error={error} />
          </FieldGroup>
          <DialogFooter className="mt-5">
            <Button disabled={busy}>
              {busy ? "Signing in…" : "Restore session"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
