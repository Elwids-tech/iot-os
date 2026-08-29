import { useState } from "react"
import type { AuthenticatedUser, Organization } from "@iot-os/api-client"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@iot-os/ui/components/breadcrumb"
import { Button } from "@iot-os/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import { Separator } from "@iot-os/ui/components/separator"
import {
  Sidebar,
  SidebarContent,
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
  BoxesIcon,
  ChevronsUpDownIcon,
  CpuIcon,
  LogOutIcon,
} from "lucide-react"
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router-dom"

const navigation = [
  { title: "Device Domain", segment: "device-domain", icon: CpuIcon },
]

function PortalSidebar({
  organization,
  organizations,
  onOrganizationChange,
}: {
  organization: Organization
  organizations: Organization[]
  onOrganizationChange: (uuid: string) => void
}) {
  const location = useLocation()
  const { setOpenMobile } = useSidebar()

  function closeMobileSidebar() {
    setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="IoT OS Tenant Portal">
              <NavLink
                to={`/organizations/${organization.uuid}/device-domain`}
                onClick={closeMobileSidebar}
              >
                <BoxesIcon />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">IoT OS</span>
                  <span className="truncate text-xs text-muted-foreground">Tenant portal</span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <Select value={organization.uuid} onValueChange={onOrganizationChange}>
          <SelectTrigger className="w-full" aria-label="Organization">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Organization</SelectLabel>
              {organizations.map((item) => (
                <SelectItem key={item.uuid} value={item.uuid}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Device domain</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => {
                const to = `/organizations/${organization.uuid}/${item.segment}`

                return (
                  <SidebarMenuItem key={item.segment}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname.startsWith(to)}
                      tooltip={item.title}
                    >
                      <NavLink to={to} onClick={closeMobileSidebar}>
                        <item.icon />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export function PortalLayout({
  user,
  onSignOut,
}: {
  user: AuthenticatedUser
  onSignOut: () => Promise<void>
}) {
  const organization = useOutletContext<Organization>()
  const location = useLocation()
  const navigate = useNavigate()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const current =
    navigation.find((item) => location.pathname.includes(`/${item.segment}`)) ?? navigation[0]

  function changeOrganization(uuid: string) {
    const tail = location.pathname.split("/").slice(3).join("/") || "device-domain"
    navigate(`/organizations/${uuid}/${tail}`)
  }

  async function signOut() {
    setIsSigningOut(true)
    await onSignOut()
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <PortalSidebar
          organization={organization}
          organizations={user.organizations}
          onOrganizationChange={changeOrganization}
        />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{current.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="ml-auto min-w-0">
                  <span className="hidden max-w-48 truncate sm:inline">{organization.name}</span>
                  <ChevronsUpDownIcon data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-foreground">{user.name}</span>
                  <span className="truncate font-normal">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled>
                    <CpuIcon />
                    {organization.name}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isSigningOut} onSelect={() => void signOut()}>
                    <LogOutIcon />
                    {isSigningOut ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <Outlet context={organization} />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
