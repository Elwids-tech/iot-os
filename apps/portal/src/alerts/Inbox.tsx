import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@iot-os/ui/components/button";
import { PageHeader } from "@iot-os/ui/components/page-header";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@iot-os/ui/components/tabs";
import { useDeviceOrganization } from "../devices/shared";
import { notificationsPath } from "./NotificationSettings";

export type InboxTab = "alerts" | "events";
const tabs: Record<InboxTab, string> = {
  alerts: "Alerts",
  events: "Event log",
};

/**
 * The single alerts inbox: alert episodes and the event log (workflow, service monitoring and watchdog
 * events). Each tab is a route under /organizations/:org/alerts. Notification settings and email
 * preferences live in Settings.
 * `header={false}` leaves the page header to the content (the narrow alert detail has its own).
 */
export function Inbox({
  tab,
  filters,
  header = true,
  children,
}: {
  tab: InboxTab;
  filters?: ReactNode;
  header?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { org, capabilities } = useDeviceOrganization();
  const base = `/organizations/${org}/alerts`;
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => navigate(value === "alerts" ? base : `${base}/${value}`)}
      className="flex-1 gap-0"
    >
      {header && (
        <PageHeader
          title={tab === "alerts" ? "Alerts" : `${tabs[tab]} · Alerts`}
          heading="Alerts"
          actions={
            capabilities.manage ? (
              <Button asChild variant="outline">
                <Link to={notificationsPath(org)}>Notification settings</Link>
              </Button>
            ) : null
          }
        >
          <div className="-mx-1 w-full overflow-x-auto scrollbar-none">
            <TabsList variant="line" className="justify-start px-1" aria-label="Alert views">
              {(Object.keys(tabs) as InboxTab[]).map((value) => (
                <TabsTrigger key={value} value={value} className="flex-none">
                  {tabs[value]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {filters}
        </PageHeader>
      )}
      <TabsContent value={tab} className="flex flex-col text-base">
        {children}
      </TabsContent>
    </Tabs>
  );
}
