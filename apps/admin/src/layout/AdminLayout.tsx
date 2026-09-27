import { runtimeConfig } from "@iot-os/api-client"
import { useState } from "react"
import type { AuthenticatedUser } from "@iot-os/api-client"
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
import { ThemePicker } from "@iot-os/ui/components/theme-picker"
import { TooltipProvider } from "@iot-os/ui/components/tooltip"
import {
  BoxesIcon,
  Building2Icon,
  ChevronsUpDownIcon,
  LogOutIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "lucide-react"
import { NavLink, Outlet, useLocation } from "react-router-dom"

const navigation = [
  { title: "Organizations", to: "/organizations", icon: Building2Icon },
  { title: "Users", to: "/users", icon: UsersIcon },
  { title: "Roles", to: "/roles", icon: ShieldCheckIcon },
  { title: "Measurement retention", to: "/settings/retention", icon: SlidersHorizontalIcon },
  { title: "Tenant portal", to: runtimeConfig("VITE_PORTAL_URL", import.meta.env.VITE_PORTAL_URL) || `${window.location.protocol}//${window.location.hostname}:5173`, icon: SlidersHorizontalIcon },
]

function AdminSidebar({ canManageRetention }: { canManageRetention: boolean }) {
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
            <SidebarMenuButton asChild size="lg" tooltip="IoT OS Administration">
              <NavLink to="/organizations" onClick={closeMobileSidebar}>
                <BoxesIcon />
                <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:sr-only">
                  <span className="truncate font-semibold">IoT OS</span>
                  <span className="truncate text-xs text-muted-foreground">Administration</span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.filter(item => item.to !== "/settings/retention" || canManageRetention).map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)}
                    tooltip={item.title}
                  >
                    <NavLink to={item.to} onClick={closeMobileSidebar}>
                      <item.icon />
                      <span className="group-data-[collapsible=icon]:sr-only">{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export function AdminLayout({
  user,
  onSignOut,
}: {
  user: AuthenticatedUser
  onSignOut: () => Promise<void>
}) {
  const location = useLocation()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const current = navigation.find((item) => location.pathname.startsWith(item.to)) ?? navigation[0]

  async function signOut() {
    setIsSigningOut(true)
    await onSignOut()
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar canManageRetention={Boolean(user.capabilities.manage_retention)} />
        <SidebarInset>
          <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{current.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto"><ThemePicker /></div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="min-w-0">
                  <span className="hidden max-w-48 truncate sm:inline">{user.name}</span>
                  <ChevronsUpDownIcon data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-foreground">{user.name}</span>
                  <span className="truncate font-normal">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={isSigningOut} onSelect={() => void signOut()}>
                    <LogOutIcon />
                    {isSigningOut ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
