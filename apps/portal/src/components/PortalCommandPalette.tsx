import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { LucideIcon } from "lucide-react"
import { BugIcon, CpuIcon, LayoutGridIcon, LightbulbIcon, PlusIcon } from "lucide-react"
import { CommandPalette, type PaletteItem } from "@iot-os/ui/components/command-palette"
import { api } from "../lib/api"
import { newTicketPath } from "../support/model"

const path = (org: string, section: string) => `/organizations/${encodeURIComponent(org)}/${section}`

/** ⌘K for the portal: pages, matching devices, dashboards and common actions. */
export function PortalCommandPalette({
  org,
  pages,
  canManageDevices,
  canViewDashboards = true,
  open,
  onOpenChange,
}: {
  org: string
  pages: { path: string; label: string; icon: LucideIcon }[]
  canManageDevices: boolean
  canViewDashboards?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState("")
  // Clear on open, not on close, so the list doesn't jump while the dialog fades out.
  useEffect(() => {
    if (open) setSearch("")
  }, [open])
  const term = search.trim()
  const devices = useQuery({
    queryKey: ["palette-devices", org, term],
    queryFn: () => api.devices(org, { search: term, per_page: 8 }),
    enabled: open && term.length > 0,
    placeholderData: keepPreviousData,
  })
  const dashboards = useQuery({
    queryKey: ["dashboards", org],
    queryFn: () => api.dashboards(org),
    enabled: open && canViewDashboards,
  })
  const go = (to: string) => () => navigate(to)
  const groups: { heading: string; items: PaletteItem[] }[] = [
    {
      heading: "Go to",
      items: pages.map((page) => ({
        id: page.path,
        label: page.label,
        icon: <page.icon />,
        onSelect: go(path(org, page.path)),
      })),
    },
    {
      heading: "Devices",
      items: term
        ? (devices.data?.data ?? []).map((device) => ({
            id: device.uuid,
            label: device.name,
            hint: device.code,
            keywords: [device.code, term],
            icon: <CpuIcon />,
            onSelect: go(path(org, `devices/${device.uuid}`)),
          }))
        : [],
    },
    {
      heading: "Dashboards",
      items: (dashboards.data ?? []).slice(0, term ? 50 : 5).map((dashboard) => ({
        id: dashboard.uuid,
        label: dashboard.name,
        hint: dashboard.folder ?? undefined,
        keywords: dashboard.tags,
        icon: <LayoutGridIcon />,
        onSelect: go(path(org, `dashboards/${dashboard.uuid}`)),
      })),
    },
    {
      heading: "Actions",
      items: [
        ...(canManageDevices
          ? [{ id: "add-device", label: "Add device", icon: <PlusIcon />, onSelect: go(path(org, "devices/onboard")) }]
          : []),
        { id: "new-automation", label: "New automation", icon: <PlusIcon />, onSelect: go(path(org, "automation/new")) },
        { id: "report-problem", label: "Report a problem", keywords: ["bug", "support", "ticket"], icon: <BugIcon />, onSelect: go(newTicketPath(org, "bug", location.pathname)) },
        { id: "suggest-improvement", label: "Suggest an improvement", keywords: ["feature", "idea", "support", "ticket"], icon: <LightbulbIcon />, onSelect: go(newTicketPath(org, "improvement", location.pathname)) },
      ],
    },
  ]
  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      groups={groups}
      search={search}
      onSearchChange={setSearch}
      loading={devices.isFetching}
    />
  )
}
