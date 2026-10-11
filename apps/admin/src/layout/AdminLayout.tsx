import { useState } from "react"
import { portalUrl } from "../lib/portal"
import type { AuthenticatedUser } from "@iot-os/api-client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@iot-os/ui/components/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarCollapse,
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
import { AppearanceMenuItems } from "@iot-os/ui/components/theme-picker"
import { TooltipProvider } from "@iot-os/ui/components/tooltip"
import {
  AppWindowIcon,
  BoxesIcon,
  Building2Icon,
  HistoryIcon,
  LogOutIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"

const navigationGroups = [
  [
    { title: "Organizations", to: "/organizations", icon: Building2Icon },
    { title: "Users", to: "/users", icon: UsersIcon },
    { title: "Roles", to: "/roles", icon: ShieldCheckIcon },
  ],
  [{ title: "Retention", to: "/settings/retention", icon: HistoryIcon }],
]

const initials = (name: string) => {
  const words = name.trim().split(/\s+/)
  return (
    words[0].slice(0, 1) + (words.length > 1 ? words[words.length - 1].slice(0, 1) : "")
  ).toUpperCase()
}

function AdminSidebar({
  user,
  isSigningOut,
  onSignOut,
}: {
  user: AuthenticatedUser
  isSigningOut: boolean
  onSignOut: () => void
}) {
  const location = useLocation()
  const { setOpenMobile } = useSidebar()
  const closeMobile = () => setOpenMobile(false)
  const groups = navigationGroups
    .map((group) =>
      group.filter(
        (item) => item.to !== "/settings/retention" || user.capabilities.manage_retention,
      ),
    )
    .filter((group) => group.length)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="IoT OS Admin" className="font-medium">
              <Link to="/organizations" onClick={closeMobile}>
                <BoxesIcon />
                <span className="truncate group-data-[collapsible=icon]:sr-only">
                  IoT OS Admin
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Platform">
          <SidebarGroup>
            <SidebarGroupContent>
              {groups.map((group, index) => (
                <div key={group[0].to}>
                  {index > 0 && <SidebarSeparator className="mx-0 my-2" />}
                  <SidebarMenu>
                    {group.map((item) => (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={
                            location.pathname === item.to ||
                            location.pathname.startsWith(`${item.to}/`)
                          }
                          tooltip={item.title}
                          className="text-muted-foreground hover:text-foreground data-active:text-foreground"
                        >
                          <NavLink to={item.to} onClick={closeMobile}>
                            <item.icon />
                            <span className="group-data-[collapsible=icon]:sr-only">
                              {item.title}
                            </span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </div>
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarCollapse />
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Tenant portal"
              className="text-muted-foreground hover:text-foreground"
            >
              <a href={portalUrl}>
                <AppWindowIcon />
                <span className="group-data-[collapsible=icon]:sr-only">Tenant portal</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  tooltip={user.name}
                  className="group-data-[collapsible=icon]:p-1.5!"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-sm bg-muted text-[10px] font-semibold text-foreground"
                  >
                    {initials(user.name)}
                  </span>
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
                <DropdownMenuItem disabled={isSigningOut} onSelect={onSignOut}>
                  <LogOutIcon />
                  {isSigningOut ? "Signing out…" : "Sign out"}
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

export function AdminLayout({
  user,
  onSignOut,
}: {
  user: AuthenticatedUser
  onSignOut: () => Promise<void>
}) {
  const [isSigningOut, setIsSigningOut] = useState(false)

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar
          user={user}
          isSigningOut={isSigningOut}
          onSignOut={() => {
            setIsSigningOut(true)
            void onSignOut()
          }}
        />
        <SidebarInset className="min-w-0">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
