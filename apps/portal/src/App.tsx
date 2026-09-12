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
  LogOutIcon,
  ArrowRightIcon,
  Building2Icon,
  SparklesIcon,
} from "lucide-react"
import { api } from "./lib/api"
import { UnsavedProvider, useDirtyContext } from "./lib/unsaved"
import { Choice, TextField, RequestError, Confirm } from "./components/forms"
import { ProfileDirectory } from "./profiles/ProfileDirectory"
const DashboardPage = lazy(() => import("./dashboards/DashboardPage").then(module => ({ default: module.DashboardPage })))
const DeviceRoutes = lazy(() => import("./devices/Routes"))
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
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-3 md:px-8">
          <Link
            to={org ? profileDirectoryPath(org.uuid) : "/"}
            className="flex items-center gap-3 font-semibold"
          >
            <CpuIcon className="text-primary" />
            <span>
              IoT OS{" "}
              <span className="font-normal text-muted-foreground">
                / Tenant portal
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {name}
            </span>
            <ThemePicker />
            {org && <Button variant="outline" aria-expanded={assistantOpen} onClick={() => { setAssistantLoaded(true); setAssistantOpen(current => !current) }}><SparklesIcon data-icon="inline-start" />Assistant</Button>}
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
        </div>
      </header>
      <div className={assistantOpen && org ? "mx-auto flex w-full max-w-[1600px] flex-1 flex-col md:pr-[440px] lg:flex-row" : "mx-auto flex w-full max-w-[1600px] flex-1 flex-col lg:flex-row"}>
        <aside className="flex flex-col gap-5 border-b p-4 lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0 lg:p-6">
          <Choice
            label="Organization"
            value={org?.uuid ?? ""}
            options={[
              { value: "", label: "Select organization" },
              ...organizations.map((item) => ({
                value: item.uuid,
                label: item.name,
              })),
            ]}
            onChange={(uuid) =>
              navigate(uuid ? profileDirectoryPath(uuid) : "/")
            }
          />
          {org && (
            <nav aria-label="Workspace" className="flex flex-col gap-2">
              {[{ path: "dashboards", label: "Dashboards" }, { path: "devices", label: "Devices" }, { path: "discovery", label: "Discovery" }, { path: "gateways", label: "Gateways" }].map(item => <Button key={item.path} asChild variant="ghost" className="justify-start [&.active]:bg-secondary"><NavLink to={`/organizations/${org.uuid}/${item.path}`}>{item.label}</NavLink></Button>)}
            <Button asChild variant="ghost" className="justify-start [&.active]:bg-secondary">
              <NavLink to={profileDirectoryPath(org.uuid)}>
                <CpuIcon data-icon="inline-start" />
                Device profiles
              </NavLink>
            </Button>
            </nav>
          )}
          <div className="hidden flex-col gap-2 text-xs text-muted-foreground lg:mt-auto lg:flex">
            <Building2Icon />
            <p>Define once. Connect through any protocol.</p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">
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
        </main>
      </div>
      {org && assistantLoaded && <Suspense fallback={null}><AssistantPanel key={org.uuid} org={org.uuid} organizationName={org.name} viewedProfile={params.profileUuid} open={assistantOpen} onClose={() => setAssistantOpen(false)} /></Suspense>}
      <Confirm
        open={logoutConfirm}
        title="Sign out without saving?"
        description="Unsaved form changes will be discarded."
        action="Sign out"
        onClose={() => setLogoutConfirm(false)}
        onConfirm={logout}
      />
    </div>
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
