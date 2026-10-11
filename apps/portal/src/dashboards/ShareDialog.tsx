import { useEffect, useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { LinkIcon, UserRoundIcon, UsersRoundIcon, XIcon } from "lucide-react"
import type { Dashboard, DashboardAccessLevel, DashboardShare } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import { ChoiceCard } from "@iot-os/ui/components/choice-card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog"
import { FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { RadioGroup } from "@iot-os/ui/components/radio-group"
import { SearchableSelect } from "@iot-os/ui/components/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@iot-os/ui/components/select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"

const key = (share: Pick<DashboardShare, "type" | "id">) => `${share.type}:${share.id}`

/**
 * Who can open and edit one dashboard. The owner and dashboard managers always
 * have full access; shares add view or edit for members and roles, and limit
 * who can open it when access is restricted.
 */
export function ShareDialog({
  org,
  dashboard,
  link,
  onClose,
  onSaved,
}: {
  org: string
  dashboard: Dashboard
  link: string
  onClose: () => void
  onSaved: (access: DashboardAccessLevel) => void
}) {
  const settings = useQuery({
    queryKey: ["dashboard-access", org, dashboard.uuid],
    queryFn: () => api.dashboardAccess(org, dashboard.uuid),
    staleTime: 0,
  })
  const [access, setAccess] = useState<DashboardAccessLevel>(dashboard.access ?? "organization")
  const [shares, setShares] = useState<DashboardShare[]>([])
  const [search, setSearch] = useState("")
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!settings.data || dirty) return
    setAccess(settings.data.access)
    setShares(settings.data.shares)
  }, [settings.data])
  const targets = useQuery({
    queryKey: ["dashboard-share-targets", org, search.trim()],
    queryFn: () => api.dashboardShareTargets(org, search.trim()),
    placeholderData: keepPreviousData,
    staleTime: 30000,
  })
  const save = useMutation({
    mutationFn: () =>
      api.updateDashboardAccess(org, dashboard.uuid, {
        access,
        shares: shares.map(({ type, id, level }) => ({ type, id, level })),
      }),
    onSuccess: (next) => {
      onSaved(next.access)
      toast.success("Sharing updated")
      onClose()
    },
  })
  const owner = settings.data?.owner
  const taken = new Set(shares.map(key))
  const available = [...(targets.data?.roles ?? []), ...(targets.data?.users ?? [])].filter(
    (target) => !taken.has(key(target)) && !(target.type === "user" && target.id === owner?.id),
  )
  const change = (next: DashboardShare[]) => {
    setShares(next)
    setDirty(true)
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      toast.success("Dashboard link copied")
    } catch {
      toast.error("The browser blocked copying. Copy the address bar instead")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Share {dashboard.name}</DialogTitle>
          <DialogDescription>The owner and people who manage dashboards can always open and edit it.</DialogDescription>
        </DialogHeader>
        {settings.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : settings.error ? (
          <RequestError error={settings.error}>
            <Button variant="outline" size="sm" onClick={() => settings.refetch()}>
              Retry
            </Button>
          </RequestError>
        ) : (
          <div className="flex flex-col gap-5">
            <FieldSet>
              <FieldLegend variant="label">Who can open it</FieldLegend>
              <RadioGroup
                value={access}
                onValueChange={(value) => {
                  setAccess(value as DashboardAccessLevel)
                  setDirty(true)
                }}
                className="gap-2"
              >
                <ChoiceCard
                  value="organization"
                  title="Everyone with dashboard access"
                  description="Anyone in this organization who can open dashboards."
                />
                <ChoiceCard
                  value="restricted"
                  title="Only the people and roles below"
                  description="Others don't see it in the library and can't open its link."
                />
              </RadioGroup>
            </FieldSet>

            <div className="flex flex-col gap-2">
              <SearchableSelect
                label="Add people or roles"
                value=""
                placeholder="Search members and roles"
                options={available.map((target) => ({
                  value: key(target),
                  label: `${target.name}${target.detail ? ` · ${target.detail}` : ""}`,
                }))}
                search={search}
                onSearchChange={setSearch}
                loading={targets.isFetching}
                emptyText="No members or roles match."
                onChange={(value) => {
                  const target = available.find((item) => key(item) === value)
                  if (target) change([...shares, { ...target, level: "view" }])
                }}
              />
              <RequestError error={targets.error} />
            </div>

            <ul aria-label="People and roles with access" className="divide-y rounded-lg border">
              {owner && (
                <li className="flex items-center gap-3 px-3 py-2">
                  <UserRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-body">{owner.name ?? "Former member"}</span>
                  <span className="text-meta text-muted-foreground">Owner</span>
                </li>
              )}
              {shares.map((share) => (
                <li key={key(share)} className="flex items-center gap-3 px-3 py-2">
                  {share.type === "role" ? (
                    <UsersRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <UserRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body">{share.name}</span>
                    {share.detail && <span className="truncate text-meta text-muted-foreground">{share.detail}</span>}
                  </span>
                  <Select
                    value={share.level}
                    onValueChange={(level) =>
                      change(shares.map((item) => (key(item) === key(share) ? { ...item, level: level as DashboardShare["level"] } : item)))
                    }
                  >
                    <SelectTrigger size="sm" className="w-28" aria-label={`Access for ${share.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="view">Can view</SelectItem>
                      <SelectItem value="edit">Can edit</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${share.name}`}
                    onClick={() => change(shares.filter((item) => key(item) !== key(share)))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
              {!shares.length && (
                <li className="px-3 py-3 text-meta text-muted-foreground">
                  {access === "restricted"
                    ? "Only the owner and dashboard managers can open it. Add people or roles to share it."
                    : "Add people or roles to let them edit it, too."}
                </li>
              )}
            </ul>
            <RequestError error={save.error} />
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => void copyLink()}>
            <LinkIcon data-icon="inline-start" />
            Copy link
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!dirty || save.isPending || !settings.data} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save sharing"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
