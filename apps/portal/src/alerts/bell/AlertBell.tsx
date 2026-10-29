import { useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import type { AlertNotificationPage, AlertNotificationReadInput } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { EmptyState } from "@iot-os/ui/components/empty-state";
import { Label } from "@iot-os/ui/components/label";
import { NotificationBell, type NotificationBellItem } from "@iot-os/ui/components/notification-bell";
import { Switch } from "@iot-os/ui/components/switch";
import { api } from "../../lib/api";
import { useAlertBell } from "./AlertBellProvider";
import { alertBellKeys } from "./model";

/**
 * The alert bell in every page header (spec 022): the alerts this person received as
 * a recipient in this organization. The list loads only while open.
 */
export function AlertBell() {
  const bell = useAlertBell();
  const [open, setOpen] = useState(false);
  const cache = useQueryClient();
  const org = bell?.org ?? "";
  const list = useInfiniteQuery({
    queryKey: alertBellKeys.list(org),
    queryFn: ({ pageParam, signal }) => api.alertNotifications(org, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last: AlertNotificationPage) =>
      last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined,
    enabled: Boolean(bell) && open,
    refetchInterval: open ? 15_000 : false,
  });
  if (!bell) return null;

  const notifications = list.data?.pages.flatMap((page) => page.data) ?? [];
  const markRead = (input: AlertNotificationReadInput, read: (id: string) => boolean) => {
    const at = new Date().toISOString();
    cache.setQueryData<InfiniteData<AlertNotificationPage>>(alertBellKeys.list(org), (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          data: page.data.map((item) => (!item.read_at && read(item.id) ? { ...item, read_at: at } : item)),
        })),
      },
    );
    void api
      .markAlertNotificationsRead(org, input)
      .then((summary) => cache.setQueryData(alertBellKeys.summary(org), summary))
      .catch(() => undefined)
      .finally(() => void cache.invalidateQueries({ queryKey: alertBellKeys.list(org) }));
  };
  const items: NotificationBellItem[] = notifications.map((item) => ({
    id: item.id,
    title: item.workflow.name,
    description: item.device?.name,
    status: item.transition,
    domain: "alert",
    detail: item.transition === "activated" ? (item.alert.condition === "active" ? "Still active" : "Cleared since") : undefined,
    time: item.occurred_at,
    to: `/organizations/${org}/alerts/${item.alert.uuid}`,
    unread: !item.read_at,
  }));
  const newest = notifications[0];
  const unread = bell.summary?.unread;

  return (
    <NotificationBell
      count={unread}
      open={open}
      onOpenChange={setOpen}
      items={items}
      loading={list.isPending}
      error={list.isError && !list.data ? "Notifications could not load. They will retry while this list is open." : undefined}
      hasOlder={list.hasNextPage}
      loadingOlder={list.isFetchingNextPage}
      onShowOlder={() => void list.fetchNextPage()}
      onSelect={(item) => item.unread && markRead({ ids: [item.id] }, (id) => id === item.id)}
      actions={
        <Button
          variant="ghost"
          size="xs"
          disabled={!newest || !unread}
          onClick={() => newest && markRead({ up_to: newest.id }, (id) => id <= newest.id)}
        >
          Mark all read
        </Button>
      }
      toolbar={
        <div className="flex items-center justify-between gap-2 text-meta">
          <Label htmlFor="alert-bell-sound" className="font-normal">Sound for new alerts in this browser</Label>
          <Switch id="alert-bell-sound" size="sm" checked={bell.sound} onCheckedChange={bell.setSound} />
        </div>
      }
      empty={
        <EmptyState
          inset
          icon={<BellIcon />}
          title="No alert notifications"
          description={
            bell.manage
              ? "Alerts appear here when an automation lists you as a recipient."
              : "Alerts appear here when an automation lists you as a recipient. Ask someone who manages automations to add you."
          }
          action={
            bell.manage ? (
              <Button asChild variant="outline" size="sm">
                <Link to={`/organizations/${org}/settings/notifications`} onClick={() => setOpen(false)}>
                  Choose recipients
                </Link>
              </Button>
            ) : undefined
          }
        />
      }
      footer={
        <Link to={`/organizations/${org}/alerts`} onClick={() => setOpen(false)} className="text-primary underline-offset-4 hover:underline">
          All alerts
        </Link>
      }
    />
  );
}
