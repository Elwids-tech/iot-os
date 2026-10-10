import { runtimeConfig } from "@iot-os/api-client"
import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import {
  ApiError,
  type AdministrationCapabilities,
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
import { PasswordRecoveryPage } from "@iot-os/auth/PasswordRecoveryPage"
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
import { PageHelpContext } from "@iot-os/ui/components/page-help"
import { helpContextForPath } from "./help/context"
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarCollapse,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
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
  BookOpenIcon,
  ActivityIcon,
  BellIcon,
  BlocksIcon,
  BoxesIcon,
  CableIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CpuIcon,
  HouseIcon,
  MailIcon,
  MapPinnedIcon,
  LayoutGridIcon,
  LogOutIcon,
  RouterIcon,
  Building2Icon,
  ScanSearchIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"
import { api } from "./lib/api"
import { UnsavedProvider, useDirtyContext } from "./lib/unsaved"
import { TextField, RequestError, Confirm } from "./components/forms"
import { ProfileDirectory } from "./profiles/ProfileDirectory"
import { RuntimeStatusBanner, RuntimeStatusProvider } from "./components/RuntimeStatus"
const HomePage = lazy(() => import("./home/HomePage"))
const AutomationRoutes = lazy(() => import("./automation/Automation"))
const DashboardPage = lazy(() => import("./dashboards/DashboardPage").then(module => ({ default: module.DashboardPage })))
const GeofenceRoutes = lazy(() => import("./geospatial/Geofences"))
const TelemetryViewer = lazy(() => import("./telemetry/TelemetryViewer"))
const AdapterRoutes = lazy(() => import("./adapters/Routes"))
const DeviceRoutes = lazy(() => import("./devices/Routes"))
const IntegrationRoutes = lazy(() => import("./integrations/Integrations"))
const AlertRoutes = lazy(() => import("./alerts/Alerts"))
const MembersPage = lazy(() => import("./members/Members").then((module) => ({ default: module.MembersPage })))
const RoleRoutes = lazy(() => import("./members/Roles"))
const NotificationCenter = lazy(() => import("./notifications/NotificationCenter"))
const HelpPanel = lazy(() => import("./help/HelpPanel"))
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
        <Route path="forgot-password" element={<PasswordRecoveryPage key="request" apiClient={api} mode="request" />} />
        <Route path="reset-password" element={<PasswordRecoveryPage key="reset" apiClient={api} mode="reset" />} />
        <Route
          path="accept-invitation"
          element={<AcceptInvitationPage apiClient={api} organizationUrl={(uuid) => sectionPath(uuid)} />}
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
              <Link to="/forgot-password" className="text-sm text-primary underline underline-offset-4">Forgot password?</Link>
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
          <Route path="notifications" element={<Suspense fallback={<PageFallback />}><NotificationCenter /></Suspense>} />
          <Route path="organizations/:organizationUuid/notifications" element={<Suspense fallback={<PageFallback />}><NotificationCenter /></Suspense>} />
          <Route path="organizations/:organizationUuid/home" element={<HomeRoute organizations={user.organizations} />} />
          <Route path="organizations/:organizationUuid/device-adapters/*" element={<Suspense fallback={<PageFallback />}><AdapterRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/devices/*" element={<Suspense fallback={<PageFallback />}><DeviceRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/integrations/*" element={<Suspense fallback={<PageFallback />}><IntegrationRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/automation/*" element={<Suspense fallback={<PageFallback />}><AutomationRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/alerts/*" element={<Suspense fallback={<PageFallback />}><AlertRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/discovery" element={<Suspense fallback={<PageFallback />}><DeviceRoutes page="discovery" /></Suspense>} />
          <Route path="organizations/:organizationUuid/telemetry" element={<Suspense fallback={<PageFallback />}><TelemetryViewer /></Suspense>} />
          <Route path="organizations/:organizationUuid/members" element={<Suspense fallback={<PageFallback />}><MembersPage /></Suspense>} />
          <Route path="organizations/:organizationUuid/roles/*" element={<Suspense fallback={<PageFallback />}><RoleRoutes /></Suspense>} />
                  <Route path="organizations/:organizationUuid/gateways" element={<Suspense fallback={<PageFallback />}><DeviceRoutes page="gateways" /></Suspense>} />
                  <Route path="organizations/:organizationUuid/sites" element={<Suspense fallback={<PageFallback />}><DeviceRoutes page="sites" /></Suspense>} />
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
            element={<OrganizationLanding userId={user.id} organizations={user.organizations} />}
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

const sectionPath = (uuid: string, section = "home") =>
  `/organizations/${encodeURIComponent(uuid)}/${section}`

/** Remembers each user's last organization across sign-outs so the chooser is only needed once. */
const lastOrganizationKey = (userId: number) => `iot-os:last-organization:${userId}`
function rememberedOrganization(userId: number): string | null {
  try {
    return window.localStorage.getItem(lastOrganizationKey(userId))
  } catch {
    return null
  }
}
function rememberOrganization(userId: number, uuid: string) {
  try {
    window.localStorage.setItem(lastOrganizationKey(userId), uuid)
  } catch {
    // Storage can be unavailable (private windows); the chooser still works.
  }
}

function OrganizationLanding({
  userId,
  organizations,
}: {
  userId: number
  organizations: Organization[]
}) {
  const preferred = api.getSelectedOrganizationUuid() ?? rememberedOrganization(userId)
  const selected =
    organizations.find((item) => item.uuid === preferred) ??
    (organizations.length === 1 ? organizations[0] : null)
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

function HomeRoute({ organizations }: { organizations: Organization[] }) {
  const { organizationUuid } = useParams()
  const org = organizations.find((item) => item.uuid === organizationUuid)
  return org ? <Suspense fallback={<PageFallback />}><HomePage organizationName={org.name} /></Suspense> : null
}

function DashboardRoute() {
  const { organizationUuid, dashboardUuid } = useParams()
  return organizationUuid ? <Suspense fallback={<PageFallback />}><DashboardPage org={organizationUuid} id={dashboardUuid} /></Suspense> : null
}

type NavigationItem = {
  path: string
  label: string
  icon: LucideIcon
  /** Older payloads without capabilities keep the link; the API still authorizes every request. */
  visible?: (organization: Organization) => boolean
}

const devicesCan = (permission: "view" | "manage") => (organization: Organization) =>
  organization.capabilities?.devices?.[permission] !== false
const profilesEditable = (organization: Organization) => {
  const profiles = organization.capabilities?.device_profiles
  return !profiles || profiles.create || profiles.update
}
// Integrations and the telemetry viewer need device view and manage (I5).
const devicesAdministered = (organization: Organization) => devicesCan("view")(organization) && devicesCan("manage")(organization)
// Member and role screens stay hidden unless the payload grants them; older payloads omit the flags.
const administers = (capability: keyof AdministrationCapabilities) => (organization: Organization) =>
  organization.capabilities?.administration?.[capability] === true

/** Grouped by job: watching the fleet first, building and connecting after. */
const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { path: "home", label: "Home", icon: HouseIcon, visible: devicesCan("view") },
      { path: "dashboards", label: "Dashboards", icon: LayoutGridIcon },
      { path: "alerts", label: "Alerts", icon: BellIcon, visible: devicesCan("view") },
    ],
  },
  {
    label: "Fleet",
    items: [
      { path: "devices", label: "Devices", icon: CpuIcon, visible: devicesCan("view") },
      { path: "gateways", label: "Gateways", icon: RouterIcon, visible: devicesCan("view") },
      { path: "sites", label: "Sites", icon: Building2Icon, visible: devicesCan("view") },
      { path: "geofences", label: "Geofences", icon: MapPinnedIcon },
    ],
  },
  {
    label: "Build",
    items: [
      { path: "automation", label: "Automations", icon: WorkflowIcon },
      { path: "device-profiles", label: "Device profiles", icon: BoxesIcon, visible: profilesEditable },
    ],
  },
  {
    label: "Connect",
    items: [
      { path: "discovery", label: "Discovery", icon: ScanSearchIcon, visible: devicesCan("manage") },
      { path: "device-adapters", label: "Device adapters", icon: CableIcon, visible: (organization) => organization.capabilities?.features?.device_adapters === true && devicesCan("manage")(organization) },
      { path: "integrations", label: "Integrations", icon: BlocksIcon, visible: devicesAdministered },
    ],
  },
  {
    label: "Diagnostics",
    items: [{ path: "telemetry", label: "Telemetry viewer", icon: ActivityIcon, visible: devicesAdministered }],
  },
  {
    label: "Organization",
    items: [
      { path: "members", label: "Members", icon: UsersIcon, visible: administers("members_view") },
      { path: "roles", label: "Roles", icon: ShieldCheckIcon, visible: administers("roles_view") },
    ],
  },
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
  helpOpen,
  onHelp,
  onSignOut,
}: {
  user: AuthenticatedUser
  organization?: Organization
  onOrganization: (uuid: string) => void
  assistantOpen: boolean
  onAssistant: () => void
  helpOpen: boolean
  onHelp: () => void
  onSignOut: () => void
}) {
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  const closeMobile = () => setOpenMobile(false)
  // Shared with the Home page so badges and the summary come from one request.
  const overview = useQuery({
    queryKey: ["overview", organization?.uuid],
    queryFn: () => api.overview(organization?.uuid ?? ""),
    enabled: Boolean(organization) && organization?.capabilities?.devices?.view !== false,
    refetchInterval: 30000,
  })
  const badges: Record<string, [number | undefined, string]> = {
    alerts: [overview.data?.alerts?.active_unacknowledged, "unacknowledged"],
    discovery: [overview.data?.discovery?.pending, "waiting"],
  }

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
            {navigationGroups.map((group) => {
              const items = group.items.filter((item) => item.visible?.(organization) ?? true)
              if (!items.length) return null
              return (
                <SidebarGroup key={group.label}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map((item) => {
                        const to = sectionPath(organization.uuid, item.path)
                        const [count, countLabel] = badges[item.path] ?? []
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
                                <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
                                {count ? (
                                  // Inside the link so screen readers announce it with the destination.
                                  <span className="ml-auto font-mono text-xs group-data-[collapsible=icon]:sr-only">
                                    {count}
                                    <span className="sr-only"> {countLabel}</span>
                                  </span>
                                ) : null}
                              </NavLink>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              )
            })}
          </nav>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarCollapse />
          {organization && <SidebarMenuItem>
            <SidebarMenuButton tooltip="Help" aria-expanded={helpOpen} onClick={() => { onHelp(); closeMobile() }} className="text-muted-foreground hover:text-foreground">
              <BookOpenIcon /><span className="group-data-[collapsible=icon]:sr-only">Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>}
          {organization && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Assistant"
                aria-expanded={assistantOpen}
                onClick={() => {
                  onAssistant()
                  closeMobile()
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <SparklesIcon />
                <span className="group-data-[collapsible=icon]:sr-only">
                  Assistant
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
                <DropdownMenuItem asChild>
                  <Link to={organization ? sectionPath(organization.uuid, "alerts/preferences") : "/notifications"}><MailIcon />Email preferences</Link>
                </DropdownMenuItem>
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
  const [activePanel, setActivePanel] = useState<"assistant" | "help" | null>(null)
  const assistantOpen = activePanel === "assistant"
  const helpOpen = activePanel === "help"
  const [helpLoaded, setHelpLoaded] = useState(false)
  const [helpOverride, setHelpOverride] = useState<string>()
  const [assistantLoaded, setAssistantLoaded] = useState(false)
  const [askRequest, setAskRequest] = useState(0)
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
    if (!org) return
    api.setSelectedOrganizationUuid(org.uuid)
    rememberOrganization(user.id, org.uuid)
  }, [org?.uuid, user.id])
  // "/organizations/{org}/{section}/..." keeps its section when switching organization (N1).
  const section = location.pathname.split("/")[3] || "home"
  const openHelp = () => { setHelpLoaded(true); setActivePanel(current => current === "help" ? null : "help") }
  // One Assistant entry point: profile authoring where profiles are built, the
  // workflow assistant inside the automation editor, and Ask Help elsewhere.
  const openAssistant = () => {
    const [, , , page, resource] = location.pathname.split("/")
    const claimed = page === "automation" && resource && !window.dispatchEvent(new Event("iot-open-automation-assistant", { cancelable: true }))
    if (claimed) {
      setActivePanel(null)
    } else if (page === "device-profiles" || (page === "devices" && resource === "onboard")) {
      setAssistantLoaded(true)
      setActivePanel(current => current === "assistant" ? null : "assistant")
    } else {
      setHelpLoaded(true)
      setAskRequest(Date.now())
      setActivePanel("help")
    }
  }
  const helpContext = helpOverride ?? helpContextForPath(location.pathname)
  const helpIntegration = useMemo(() => org ? {
    trigger: <Button variant="ghost" size="sm" aria-expanded={helpOpen} onClick={openHelp}><BookOpenIcon data-icon="inline-start" />Help</Button>,
    onContextChange: setHelpOverride,
  } : null, [org?.uuid, helpOpen])

  return (
    <TooltipProvider>
      <PageHelpContext.Provider value={helpIntegration}>
      <RuntimeStatusProvider org={org?.uuid}>
      <SidebarProvider>
        <PortalSidebar
          user={user}
          organization={org}
          onOrganization={(uuid) => navigate(sectionPath(uuid, section))}
          helpOpen={helpOpen}
          onHelp={openHelp}
          assistantOpen={assistantOpen}
          onAssistant={openAssistant}
          onSignOut={() =>
            dirty ? setLogoutConfirm(true) : void logout().catch(() => {})
          }
        />
        <SidebarInset
          className={cn(
            "min-w-0",
            // Below xl the assistant overlays the page; from xl it docks beside it.
            (assistantOpen || helpOpen) && org && "xl:pr-[440px]",
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
            <>
              {org && <RuntimeStatusBanner />}
              <Outlet />
            </>
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
              onClose={() => setActivePanel(null)}
            />
          </Suspense>
        )}
        {org && helpLoaded && <Suspense fallback={null}>
          <HelpPanel key={org.uuid} org={org.uuid} organizationName={org.name} context={helpContext} open={helpOpen} onClose={() => setActivePanel(null)} askRequest={askRequest} />
        </Suspense>}
        <Confirm
          open={logoutConfirm}
          title="Sign out without saving?"
          description="Unsaved form changes will be discarded."
          action="Sign out"
          onClose={() => setLogoutConfirm(false)}
          onConfirm={logout}
        />
      </SidebarProvider>
      </RuntimeStatusProvider>
      </PageHelpContext.Provider>
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
