import { runtimeConfig } from "@iot-os/api-client"
import { lazy, Suspense, useEffect, useState } from "react"
import {
  ApiError,
  type AuthenticatedUser,
  type Organization,
} from "@iot-os/api-client"
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
import {
  AppearanceMenuItems,
  ThemePicker,
} from "@iot-os/ui/components/theme-picker"
import { PageHeader } from "@iot-os/ui/components/page-header"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
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
import { cn } from "@iot-os/ui/lib/utils"
import {
  BellIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CpuIcon,
  LayersIcon,
  MapPinnedIcon,
  LayoutGridIcon,
  LogOutIcon,
  MessageSquareIcon,
  PlugIcon,
  RouterIcon,
  ScanSearchIcon,
  ShieldIcon,
} from "lucide-react"
import { api } from "./lib/api"
import { UnsavedProvider, useDirtyContext } from "./lib/unsaved"
import { TextField, RequestError, Confirm } from "./components/forms"
import { ProfileDirectory } from "./profiles/ProfileDirectory"
const DashboardPage = lazy(() => import("./dashboards/DashboardPage").then(module => ({ default: module.DashboardPage })))
const GeofenceRoutes = lazy(() => import("./geospatial/Geofences"))
const DeviceRoutes = lazy(() => import("./devices/Routes"))
const IntegrationRoutes = lazy(() => import("./integrations/Integrations"))
const AlertRoutes = lazy(() => import("./alerts/Alerts"))
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
              : "Sign in to monitor devices, dashboards and alerts."}
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
  const [expired, setExpired] = useState(false)
  const signedOut = useSignedOut()
  useEffect(() => {
    const expire = () => setExpired(true)
    window.addEventListener("iot-session-expired", expire)
    return () => window.removeEventListener("iot-session-expired", expire)
  }, [])
  const cache = useQueryClient()
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
        <Route element={<PortalShell user={user} />}>
          <Route path="organizations/:organizationUuid/devices/*" element={<Suspense fallback={<PageFallback />}><DeviceRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/integrations/*" element={<Suspense fallback={<PageFallback />}><IntegrationRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/alerts/*" element={<Suspense fallback={<PageFallback />}><AlertRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/discovery" element={<Suspense fallback={<PageFallback />}><DeviceRoutes page="discovery" /></Suspense>} />
          <Route path="organizations/:organizationUuid/gateways" element={<Suspense fallback={<PageFallback />}><DeviceRoutes page="gateways" /></Suspense>} />
          <Route path="organizations/:organizationUuid/dashboards/:dashboardUuid?" element={<DashboardRoute />} />
          <Route path="organizations/:organizationUuid/geofences/*" element={<Suspense fallback={<PageFallback />}><GeofenceRoutes /></Suspense>} />
          <Route
            path="organizations/:organizationUuid/device-profiles"
            element={<ProfileDirectory />}
          />
          <Route
            path="organizations/:organizationUuid/device-profiles/:profileUuid/:section?"
            element={
              <Suspense fallback={<PageFallback />}>
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
          onSignOut={async () => {
            // The session is already gone; logout only clears what the server still holds.
            await api.logout().catch(() => {})
            setExpired(false)
            await signedOut()
          }}
        />
      )}
    </>
  )
}

/** Placeholder while a lazily loaded page's code arrives; pages add their own padding under PageHeader. */
function PageFallback() {
  return (
    <div className="p-4 md:p-6">
      <Skeleton className="h-80 w-full" />
    </div>
  )
}

/** Clears client state after the server session ends and returns to sign in. */
function useSignedOut() {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const { setDirty } = useDirtyContext()
  return async () => {
    api.setSelectedOrganizationUuid(null)
    setDirty(false)
    cache.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    })
    await cache.resetQueries({ queryKey: ["session"] })
    navigate("/", { replace: true })
  }
}

const sectionPath = (uuid: string, section = "dashboards") =>
  `/organizations/${encodeURIComponent(uuid)}/${section}`

function OrganizationLanding({
  organizations,
}: {
  organizations: Organization[]
}) {
  const selected =
    organizations.find(
      (item) => item.uuid === api.getSelectedOrganizationUuid(),
    ) ?? (organizations.length === 1 ? organizations[0] : null)
  if (selected) return <Navigate to={sectionPath(selected.uuid)} replace />
  return (
    <>
      <PageHeader title="Choose an organization" />
      <div className="p-4 md:p-6">
        <OrganizationLinks organizations={organizations} />
      </div>
    </>
  )
}

function WorkspaceUnavailable({
  organizations,
}: {
  organizations: Organization[]
}) {
  return (
    <>
      <PageHeader title="Workspace unavailable" />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <p className="text-muted-foreground">
          You don't have access to this organization.
        </p>
        <OrganizationLinks organizations={organizations} />
      </div>
    </>
  )
}

function OrganizationLinks({
  organizations,
}: {
  organizations: Organization[]
}) {
  if (!organizations.length)
    return (
      <p className="text-muted-foreground">
        You don't belong to an organization yet. Ask your organization
        administrator for an invitation.
      </p>
    )
  return (
    <ul className="max-w-xl divide-y rounded-lg border bg-card">
      {organizations.map((org) => (
        <li key={org.uuid}>
          <Link
            to={sectionPath(org.uuid)}
            className="flex h-12 items-center gap-3 px-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Mark text={initials(org.name, 1)} className="bg-foreground text-background" />
            <span className="truncate font-medium">{org.name}</span>
            <span className="truncate text-sm text-muted-foreground">{org.slug}</span>
            <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Square initials used for the organization and the signed-in user. */
function Mark({ text, className }: { text: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-sm text-[10px] font-semibold",
        className,
      )}
    >
      {text}
    </span>
  )
}

const initials = (name: string, count = 2) => {
  const words = name.trim().split(/\s+/)
  return (count === 1 || words.length === 1
    ? words[0].slice(0, 1)
    : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1)
  ).toUpperCase()
}

function DashboardRoute() {
  const { organizationUuid, dashboardUuid } = useParams()
  return organizationUuid ? <Suspense fallback={<PageFallback />}><DashboardPage org={organizationUuid} id={dashboardUuid} /></Suspense> : null
}

const navigationGroups = [
  [
    { path: "dashboards", label: "Dashboards", icon: LayoutGridIcon },
    { path: "alerts", label: "Alerts", icon: BellIcon },
  ],
  [
    { path: "devices", label: "Devices", icon: CpuIcon },
    { path: "gateways", label: "Gateways", icon: RouterIcon },
    { path: "geofences", label: "Geofences", icon: MapPinnedIcon },
    { path: "discovery", label: "Discovery", icon: ScanSearchIcon },
  ],
  [
    { path: "device-profiles", label: "Device profiles", icon: LayersIcon },
    { path: "integrations", label: "Integrations", icon: PlugIcon },
  ],
]

const adminUrl =
  runtimeConfig("VITE_ADMIN_URL", import.meta.env.VITE_ADMIN_URL) ||
  `${window.location.protocol}//${window.location.hostname}:5174`

function PortalSidebar({
  user,
  organization,
  onOrganization,
  assistantOpen,
  onAssistant,
  onSignOut,
}: {
  user: AuthenticatedUser
  organization?: Organization
  onOrganization: (uuid: string) => void
  assistantOpen: boolean
  onAssistant: () => void
  onSignOut: () => void
}) {
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  const closeMobile = () => setOpenMobile(false)
  const devices = organization?.capabilities?.devices
  const alerts = useQuery({
    queryKey: ["alerts", organization?.uuid, "unacknowledged-count"],
    queryFn: () =>
      api.alerts(
        organization?.uuid ?? "",
        "condition=active&acknowledged=0&per_page=1",
      ),
    enabled: Boolean(organization) && devices?.view !== false,
    refetchInterval: 30000,
    select: (page) => page.meta?.total ?? 0,
  })
  // Integrations need device view and manage (I5); older payloads without capabilities keep the link.
  const hidden = (path: string) =>
    path === "integrations" && devices !== undefined && !(devices.view && devices.manage)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  tooltip={organization?.name ?? "Choose organization"}
                  aria-label={
                    organization
                      ? `Organization: ${organization.name}`
                      : "Choose organization"
                  }
                  className="font-medium group-data-[collapsible=icon]:p-1.5!"
                >
                  <Mark
                    text={organization ? initials(organization.name, 1) : "?"}
                    className="bg-foreground text-[11px] text-background"
                  />
                  <span className="truncate group-data-[collapsible=icon]:sr-only">
                    {organization?.name ?? "Choose organization"}
                  </span>
                  <ChevronsUpDownIcon className="ml-auto text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                {user.organizations.length ? (
                  <DropdownMenuRadioGroup
                    value={organization?.uuid ?? ""}
                    onValueChange={(uuid) => {
                      onOrganization(uuid)
                      closeMobile()
                    }}
                  >
                    {user.organizations.map((item) => (
                      <DropdownMenuRadioItem key={item.uuid} value={item.uuid}>
                        <span className="truncate">{item.name}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                ) : (
                  <DropdownMenuItem disabled>No organizations</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {organization && (
          <nav aria-label="Workspace">
            <SidebarGroup>
              <SidebarGroupContent>
                {navigationGroups.map((group, index) => (
                  <div key={group[0].path}>
                    {index > 0 && <SidebarSeparator className="mx-0 my-2" />}
                    <SidebarMenu>
                      {group
                        .filter((item) => !hidden(item.path))
                        .map((item) => {
                          const to = sectionPath(organization.uuid, item.path)
                          const count =
                            item.path === "alerts" ? alerts.data : undefined
                          return (
                            <SidebarMenuItem key={item.path}>
                              <SidebarMenuButton
                                asChild
                                tooltip={item.label}
                                isActive={
                                  location.pathname === to ||
                                  location.pathname.startsWith(`${to}/`)
                                }
                                className="text-muted-foreground hover:text-foreground data-active:text-foreground"
                              >
                                <NavLink to={to} onClick={closeMobile}>
                                  <item.icon />
                                  <span className="group-data-[collapsible=icon]:sr-only">
                                    {item.label}
                                  </span>
                                  {count ? (
                                    <span className="ml-auto font-mono text-xs group-data-[collapsible=icon]:sr-only">
                                      {count}
                                      <span className="sr-only"> unacknowledged</span>
                                    </span>
                                  ) : null}
                                </NavLink>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          )
                        })}
                    </SidebarMenu>
                  </div>
                ))}
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {organization && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Profile assistant"
                aria-expanded={assistantOpen}
                onClick={() => {
                  onAssistant()
                  closeMobile()
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <MessageSquareIcon />
                <span className="group-data-[collapsible=icon]:sr-only">
                  Profile assistant
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  tooltip={user.name}
                  className="group-data-[collapsible=icon]:p-1.5!"
                >
                  <Mark text={initials(user.name)} className="bg-muted text-foreground" />
                  <span className="truncate group-data-[collapsible=icon]:sr-only">
                    {user.name}
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuLabel className="truncate font-normal">
                  {user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <AppearanceMenuItems />
                <DropdownMenuSeparator />
                {user.capabilities.platform_administration && (
                  <DropdownMenuItem asChild>
                    <a href={adminUrl}>
                      <ShieldIcon />
                      Administration
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onSignOut}>
                  <LogOutIcon />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function PortalShell({ user }: { user: AuthenticatedUser }) {
  const params = useParams()
  const org = user.organizations.find(
    (item) => item.uuid === params.organizationUuid,
  )
  const navigate = useNavigate()
  const location = useLocation()
  const signedOut = useSignedOut()
  const { dirty } = useDirtyContext()
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
    await signedOut()
  }
  useEffect(() => {
    if (org) api.setSelectedOrganizationUuid(org.uuid)
  }, [org?.uuid])
  // "/organizations/{org}/{section}/..." keeps its section when switching organization (N1).
  const section = location.pathname.split("/")[3] || "dashboards"

  return (
    <TooltipProvider>
      <SidebarProvider>
        <PortalSidebar
          user={user}
          organization={org}
          onOrganization={(uuid) => navigate(sectionPath(uuid, section))}
          assistantOpen={assistantOpen}
          onAssistant={() => {
            setAssistantLoaded(true)
            setAssistantOpen((current) => !current)
          }}
          onSignOut={() =>
            dirty ? setLogoutConfirm(true) : void logout().catch(() => {})
          }
        />
        <SidebarInset
          className={cn(
            "min-w-0",
            // Below xl the assistant overlays the page; from xl it docks beside it.
            assistantOpen && org && "xl:pr-[440px]",
          )}
        >
          {logoutError ? (
            <div className="p-4 md:px-6">
              <RequestError error={logoutError} />
            </div>
          ) : null}
          {params.organizationUuid && !org ? (
            <WorkspaceUnavailable organizations={user.organizations} />
          ) : (
            <Outlet />
          )}
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
  onSignOut,
}: {
  email: string
  onRecovered: () => Promise<void>
  onSignOut: () => Promise<void>
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [signingOut, setSigningOut] = useState(false),
    [confirmDiscard, setConfirmDiscard] = useState(false)
  const { dirty } = useDirtyContext()
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
            {confirmDiscard && (
              <p className="text-sm" role="alert">
                Signing out discards your unsaved changes.
              </p>
            )}
          </FieldGroup>
          <DialogFooter className="mt-5">
            {confirmDiscard && (
              <Button
                type="button"
                variant="ghost"
                disabled={signingOut}
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </Button>
            )}
            <Button
              type="button"
              variant={confirmDiscard ? "destructive" : "outline"}
              disabled={busy || signingOut}
              onClick={() => {
                if (dirty && !confirmDiscard) return setConfirmDiscard(true)
                setSigningOut(true)
                void onSignOut()
              }}
            >
              {confirmDiscard ? "Discard and sign out" : "Sign out"}
            </Button>
            <Button disabled={busy || signingOut}>
              {busy ? "Signing in…" : "Restore session"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
