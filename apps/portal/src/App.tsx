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
import { ErrorBoundary } from "@iot-os/ui/components/error-boundary"
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
import { useLastDashboardPath } from "./dashboards/lastPlace"
import { PortalCommandPalette } from "./components/PortalCommandPalette"
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
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  LayoutGridIcon,
  LifeBuoyIcon,
  LogOutIcon,
  RouterIcon,
  ScanSearchIcon,
  ShieldIcon,
  SparklesIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"
import { api } from "./lib/api"
import { useSupportUnread } from "./support/model"
import { UnsavedProvider, useDirtyContext } from "./lib/unsaved"
import { PanelProvider, usePanel } from "./panel/context"
import { TextField, RequestError, Confirm } from "./components/forms"
import { ProfileDirectory } from "./profiles/ProfileDirectory"
import { RuntimeStatusBanner, RuntimeStatusProvider } from "./components/RuntimeStatus"
import { AlertBellProvider } from "./alerts/bell/AlertBellProvider"
import { AlertBell } from "./alerts/bell/AlertBell"
const HomePage = lazy(() => import("./home/HomePage"))
const AutomationRoutes = lazy(() => import("./automation/Automation"))
const DashboardPage = lazy(() => import("./dashboards/DashboardPage").then(module => ({ default: module.DashboardPage })))
const GeofenceRoutes = lazy(() => import("./geospatial/Geofences"))
const TelemetryViewer = lazy(() => import("./telemetry/TelemetryViewer"))
const AdapterRoutes = lazy(() => import("./adapters/Routes"))
const DeviceRoutes = lazy(() => import("./devices/Routes"))
const IntegrationRoutes = lazy(() => import("./integrations/Integrations"))
const AlertRoutes = lazy(() => import("./alerts/Alerts"))
const SettingsRoutes = lazy(() => import("./settings/Settings"))
const ConnectPage = lazy(() => import("./agents/ConnectPage"))
const NotificationCenter = lazy(() => import("./notifications/NotificationCenter"))
const SupportRoutes = lazy(() => import("./support/Support"))
const HelpPanel = lazy(() => import("./help/HelpPanel"))
const ProfileAssistantBody = lazy(() => import("./assistant/AssistantPanel"))
const OnboardingAssistantBody = lazy(() => import("./adapters/OnboardingAssistant"))
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
          element={
            <AcceptInvitationPage apiClient={api} adminUrl={adminUrl} organizationUrl={(uuid) => sectionPath(uuid)} />
          }
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
        {/* An AI agent asking to connect: a standalone page, outside the workspace shell. */}
        <Route path="connect" element={<Suspense fallback={<PageFallback />}><ConnectPage /></Suspense>} />
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
          <Route path="organizations/:organizationUuid/settings/*" element={<Suspense fallback={<PageFallback />}><SettingsRoutes /></Suspense>} />
          <Route path="organizations/:organizationUuid/support/*" element={<Suspense fallback={<PageFallback />}><SupportRoutes /></Suspense>} />
          {/* Members and roles moved into Settings; older links still land there. */}
          <Route path="organizations/:organizationUuid/members" element={<MovedTo from="members" section="settings/members" />} />
          <Route path="organizations/:organizationUuid/roles/*" element={<MovedTo from="roles" section="settings/roles" />} />
          <Route path="organizations/:organizationUuid/connections" element={<Suspense fallback={<PageFallback />}><DeviceRoutes page="connections" /></Suspense>} />
                  <Route path="organizations/:organizationUuid/gateways/*" element={<Suspense fallback={<PageFallback />}><DeviceRoutes page="gateways" /></Suspense>} />
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

/**
 * Placeholder while a lazily loaded page's code arrives. It mirrors the page
 * shell (header row, filter row, list rows) so the real page replaces it in
 * place instead of popping in under a blank block.
 */
function PageFallback() {
  return (
    <div aria-busy="true" aria-label="Loading page" role="status">
      <div className="flex min-h-14 items-center gap-3 border-b px-4 py-2 md:px-6">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="ml-auto h-8 w-24" />
      </div>
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-28" />
        </div>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
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
        "grid size-5 shrink-0 place-items-center rounded-sm text-micro font-semibold",
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
  /** Other sections that light this item, e.g. Geofences under Locations. */
  also?: string[]
  /** Older payloads without capabilities keep the link; the API still authorizes every request. */
  visible?: (organization: Organization) => boolean
}

/** Sends an old section URL to where it lives now, keeping the rest of the path and the query. */
function MovedTo({ from, section }: { from: string; section: string }) {
  const { organizationUuid = "" } = useParams()
  const { pathname, search } = useLocation()
  // The outer routes are a splat, so take the remainder from the path rather than useParams()["*"].
  const rest = pathname.slice(sectionPath(organizationUuid, from).length)
  return <Navigate to={`${sectionPath(organizationUuid, section)}${rest}${search}`} replace />
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

/**
 * Grouped by job. Monitor: what's happening. Fleet: what you have. Build:
 * anything with a draft and a publish. Connect: data in and out. Tools and
 * Settings sit at the foot of the sidebar.
 */
const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { path: "home", label: "Home", icon: HouseIcon, visible: devicesCan("view") },
      { path: "dashboards", label: "Dashboards", icon: LayoutGridIcon, visible: (organization) => organization.capabilities?.dashboards?.view !== false },
      { path: "alerts", label: "Alerts", icon: BellIcon, visible: devicesCan("view") },
    ],
  },
  {
    label: "Fleet",
    items: [
      { path: "devices", label: "Devices", icon: CpuIcon, visible: devicesCan("view") },
      { path: "gateways", label: "Gateways", icon: RouterIcon, visible: devicesCan("view") },
      { path: "sites", label: "Locations", icon: MapPinnedIcon, also: ["geofences"], visible: devicesCan("view") },
    ],
  },
  {
    label: "Build",
    items: [
      { path: "automation", label: "Automations", icon: WorkflowIcon },
      { path: "device-profiles", label: "Device profiles", icon: BoxesIcon, visible: profilesEditable },
      { path: "device-adapters", label: "Device adapters", icon: CableIcon, visible: (organization) => organization.capabilities?.features?.device_adapters === true && devicesCan("manage")(organization) },
    ],
  },
  {
    label: "Connect",
    items: [
      { path: "discovery", label: "Discovery", icon: ScanSearchIcon, visible: devicesCan("manage") },
      { path: "integrations", label: "Integrations", icon: BlocksIcon, visible: devicesAdministered },
      { path: "connections", label: "Connections", icon: PlugIcon, visible: devicesCan("view") },
    ],
  },
]
const activeFor = (item: NavigationItem, organization: string, pathname: string) =>
  [item.path, ...(item.also ?? [])].some((path) => {
    const to = sectionPath(organization, path)
    return pathname === to || pathname.startsWith(`${to}/`)
  })

/** Tools and Settings sit at the foot of the sidebar, above help and the account menu. */
const footerItems: NavigationItem[] = [
  { path: "telemetry", label: "Telemetry viewer", icon: ActivityIcon, visible: devicesAdministered },
  { path: "support", label: "Support", icon: LifeBuoyIcon },
  { path: "settings", label: "Settings", icon: SettingsIcon, also: ["members", "roles"] },
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
  onSearch,
}: {
  onSearch: () => void
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
  // Dashboards reopens the dashboard (or the library) the viewer was last on.
  const dashboards = useLastDashboardPath(user.id, organization?.uuid ?? "")
  // Shared with the Home page so badges and the summary come from one request.
  const overview = useQuery({
    queryKey: ["overview", organization?.uuid],
    queryFn: () => api.overview(organization?.uuid ?? ""),
    enabled: Boolean(organization) && organization?.capabilities?.devices?.view !== false,
    refetchInterval: 30000,
  })
  const unreadTickets = useSupportUnread(organization?.uuid)
  const badges: Record<string, [number | undefined, string]> = {
    alerts: [overview.data?.alerts?.active_unacknowledged, "unacknowledged"],
    discovery: [overview.data?.discovery?.pending, "waiting"],
    support: [unreadTickets, "unread"],
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
                    className="bg-foreground text-micro text-background"
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
          <SidebarGroup className="pb-0" role="search" aria-label="Workspace search">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Search or jump to (⌘K)"
                  onClick={() => {
                    onSearch()
                    closeMobile()
                  }}
                  className="border bg-background text-muted-foreground shadow-panel hover:text-foreground"
                >
                  <SearchIcon />
                  <span className="group-data-[collapsible=icon]:sr-only">Search or jump to…</span>
                  <kbd className="ml-auto font-mono text-meta text-muted-foreground group-data-[collapsible=icon]:hidden">⌘K</kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
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
                        const to = item.path === "dashboards" ? dashboards : sectionPath(organization.uuid, item.path)
                        const [count, countLabel] = badges[item.path] ?? []
                        return (
                          <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton
                              asChild
                              tooltip={item.label}
                              isActive={activeFor(item, organization.uuid, location.pathname)}
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
        {organization && (
          <nav aria-label="Tools and settings" className="mt-auto">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {footerItems
                  .filter((item) => item.visible?.(organization) ?? true)
                  .map((item) => {
                    const [count, countLabel] = badges[item.path] ?? []
                    return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        tooltip={item.label}
                        isActive={activeFor(item, organization.uuid, location.pathname)}
                        className="text-muted-foreground hover:text-foreground data-active:text-foreground"
                      >
                        <NavLink to={sectionPath(organization.uuid, item.path)} onClick={closeMobile}>
                          <item.icon />
                          <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
                          {count ? (
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
                  <Link to={organization ? sectionPath(organization.uuid, "settings/email") : "/notifications"}><MailIcon />Email preferences</Link>
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
  return (
    <PanelProvider>
      <PortalShellContent user={user} />
    </PanelProvider>
  )
}

function PortalShellContent({ user }: { user: AuthenticatedUser }) {
  const params = useParams()
  const org = user.organizations.find(
    (item) => item.uuid === params.organizationUuid,
  )
  const navigate = useNavigate()
  const location = useLocation()
  const signedOut = useSignedOut()
  const { dirty } = useDirtyContext()
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const panel = usePanel()
  const assistantOpen = panel.open && panel.tab === "ask"
  const helpOpen = panel.open && panel.tab !== "ask"
  // The panel's code loads on first open and then stays mounted, so conversations and drafts survive closing it.
  const [panelLoaded, setPanelLoaded] = useState(false)
  useEffect(() => {
    if (panel.open) setPanelLoaded(true)
  }, [panel.open])
  const [helpOverride, setHelpOverride] = useState<string>()
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
  const openHelp = () => panel.togglePanel("page")
  // One Assistant control everywhere: the panel's Ask tab shows the assistant for the
  // current page (profile authoring, the automation editor's slot, or usage help).
  const openAssistant = () => panel.togglePanel("ask")
  const [, , , page, resource] = location.pathname.split("/")
  const adaptersUsable = Boolean(org && org.capabilities?.features?.device_adapters === true && devicesCan("manage")(org))
  // Add device and the adapter pages open Ask on onboarding, which also drafts missing profiles.
  const onboardingContext = adaptersUsable && (page === "device-adapters" || (page === "devices" && resource === "onboard"))
  const profileContext = page === "device-profiles" || (page === "devices" && resource === "onboard" && !onboardingContext)
  const viewedAdapter = page === "device-adapters" && resource && resource !== "new" ? resource : undefined
  const helpContext = helpOverride ?? helpContextForPath(location.pathname)
  // Every page header carries the alert bell, the Assistant and Help; on phones they shrink to their icons.
  const bellVisible = Boolean(org && devicesCan("view")(org))
  const helpIntegration = useMemo(() => org ? {
    trigger: (
      <>
        {bellVisible && <AlertBell />}
        <Button variant="ghost" size="sm" aria-expanded={assistantOpen} onClick={openAssistant}>
          <SparklesIcon data-icon="inline-start" />
          <span className="max-sm:sr-only">Assistant</span>
        </Button>
        <Button variant="ghost" size="sm" aria-expanded={helpOpen} onClick={openHelp}>
          <BookOpenIcon data-icon="inline-start" />
          <span className="max-sm:sr-only">Help</span>
        </Button>
      </>
    ),
    onContextChange: setHelpOverride,
  } : null, [org?.uuid, bellVisible, assistantOpen, helpOpen, panel])

  // ⌘K / Ctrl+K opens search from anywhere in the workspace.
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    if (!org) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [org])
  const palettePages = org
    ? [...navigationGroups.flatMap((group) => group.items), ...footerItems].filter(
        (item) => item.visible?.(org) ?? true,
      )
    : []

  return (
    <TooltipProvider>
      {org && (
        <PortalCommandPalette
          org={org.uuid}
          pages={palettePages}
          canManageDevices={devicesCan("manage")(org)}
          canViewDashboards={org.capabilities?.dashboards?.view !== false}
          open={searchOpen}
          onOpenChange={setSearchOpen}
        />
      )}
      <PageHelpContext.Provider value={helpIntegration}>
      <RuntimeStatusProvider org={org?.uuid}>
      <AlertBellProvider
        key={org?.uuid}
        org={org?.uuid}
        userId={user.id}
        enabled={bellVisible}
        manage={Boolean(org && devicesCan("manage")(org))}
      >
      <SidebarProvider>
        <PortalSidebar
          onSearch={() => setSearchOpen(true)}
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
            "min-w-0 transition-[padding] duration-200 ease-out",
            // Below xl the assistant overlays the page; from xl it docks beside it.
            panel.open && org && "xl:pr-[440px]",
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
              {/* Keyed by section so moving between areas fades the new page in; routes inside a section keep their state. */}
              <div
                key={section}
                className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-150"
              >
                <ErrorBoundary resetKey={location.pathname}>
                  <Outlet />
                </ErrorBoundary>
              </div>
            </>
          )}
        </SidebarInset>
        {org && panelLoaded && (
          <Suspense fallback={null}>
            <HelpPanel
              key={org.uuid}
              org={org.uuid}
              organizationName={org.name}
              context={helpContext}
              profileAssistant={
                <ProfileAssistantBody
                  org={org.uuid}
                  organizationName={org.name}
                  viewedProfile={params.profileUuid}
                />
              }
              profilePage={profileContext}
              onboardingAssistant={
                <OnboardingAssistantBody org={org.uuid} adapterUuid={viewedAdapter} canEdit={adaptersUsable} />
              }
              onboardingPage={onboardingContext}
              viewedProfile={params.profileUuid}
              can={{ profiles: profilesEditable(org), adapters: adaptersUsable }}
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
      </AlertBellProvider>
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
