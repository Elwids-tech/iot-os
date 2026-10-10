import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, MailXIcon } from "lucide-react";
import {
  ApiError,
  type NotificationLevel,
  type NotificationPreferences,
  type NotificationSource,
} from "@iot-os/api-client";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iot-os/ui/components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@iot-os/ui/components/field";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { StatusMark } from "@iot-os/ui/components/status-mark";
import { Switch } from "@iot-os/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import { Inbox } from "./Inbox";

export const sources: Record<NotificationSource, { label: string; description: string }> = {
  workflow: { label: "Workflow alerts", description: "Device and automation conditions in your organizations." },
  service: { label: "Service monitoring", description: "Grafana / Prometheus service, resource, and log alerts." },
  watchdog: { label: "Host watchdog", description: "Independent checks of the application host, API, and MQTT." },
};
export const levels: NotificationLevel[] = ["critical", "warning", "info", "recovery"];
/** "recovery" stays the stored key; people read it as the alert clearing. */
export const labels: Record<NotificationLevel, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Information",
  recovery: "Cleared",
};
export const variants = { critical: "destructive", warning: "warning", info: "info", recovery: "success" } as const;
export const tones = { critical: "critical", warning: "warning", info: "info", recovery: "good" } as const;
const preferenceKey = ["notification-preferences"];

export function EmailPreferencesPage() {
  return (
    <Inbox tab="preferences">
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <EmailPreferences />
      </div>
    </Inbox>
  );
}

/** Personal email preferences across all organizations, saved on every change. */
export function EmailPreferences() {
  const cache = useQueryClient();
  const prefs = useQuery({ queryKey: preferenceKey, queryFn: () => api.notificationPreferences() });
  const save = useMutation({
    mutationFn: (next: NotificationPreferences) => api.updateNotificationPreferences(next),
    onSuccess: (data) => cache.setQueryData(preferenceKey, data),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409)
        void cache.invalidateQueries({ queryKey: preferenceKey });
    },
  });
  const data = prefs.data;
  return (
    <>
      <RequestError error={prefs.error ?? save.error} />
      {data && (
        <Alert>
          <BellIcon />
          <AlertTitle>
            {data.email_enabled ? "Email delivery follows your preferences" : "All alert emails are off"}
          </AlertTitle>
          <AlertDescription>
            {data.email_enabled
              ? "Choose which alerts reach your inbox below. Alerts and the event log are always available here."
              : "Workflow, service monitoring, and watchdog emails are muted. Alerts and the event log continue to record them."}
            {save.isPending && <span role="status"> Saving…</span>}
          </AlertDescription>
        </Alert>
      )}
      {prefs.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        data && (
          <Card>
            <CardHeader>
              <CardTitle>Email preferences</CardTitle>
              <CardDescription>
                These settings apply to your account across all organizations. Changes save immediately.
              </CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  disabled={save.isPending || !data.email_enabled}
                  onClick={() => save.mutate({ ...data, email_enabled: false })}
                >
                  <MailXIcon data-icon="inline-start" />
                  Turn off all emails
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="all-alert-emails">Allow alert emails</FieldLabel>
                  <FieldDescription>
                    The master switch overrides every email subscription, including queued alert emails.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="all-alert-emails"
                  checked={data.email_enabled}
                  disabled={save.isPending}
                  onCheckedChange={(email_enabled) => save.mutate({ ...data, email_enabled })}
                />
              </Field>
              <Table aria-label="Notification preferences grid">
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert type</TableHead>
                    {levels.map((level) => (
                      <TableHead key={level} className="text-center">
                        <Badge variant={variants[level]}>{labels[level]}</Badge>
                      </TableHead>
                    ))}
                    <TableHead className="text-center">In app</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(Object.keys(sources) as NotificationSource[]).map((source) => {
                    const available = source === "workflow" || data.operations_access;
                    return (
                      <TableRow key={source}>
                        <TableCell className="min-w-52 whitespace-normal">
                          <FieldTitle>{sources[source].label}</FieldTitle>
                          <p className="mt-1 text-sm text-muted-foreground">{sources[source].description}</p>
                          {!available && (
                            <p className="mt-1 text-xs text-muted-foreground">Platform operator access required.</p>
                          )}
                        </TableCell>
                        {levels.map((level) => (
                          <TableCell key={level} className="text-center">
                            <Switch
                              aria-label={`${sources[source].label}: ${labels[level]} emails`}
                              checked={data.grid[source][level]}
                              disabled={save.isPending || !available}
                              onCheckedChange={(enabled) =>
                                save.mutate({
                                  ...data,
                                  grid: { ...data.grid, [source]: { ...data.grid[source], [level]: enabled } },
                                })
                              }
                            />
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          <StatusMark tone={available ? "good" : "muted"}>
                            {available ? "Always on" : "Restricted"}
                          </StatusMark>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground">
                Email choices are retained while the master switch is off. Workflow emails also require the
                workflow to list you as a recipient in Notification settings. Password reset and account
                invitation emails are separate.
              </p>
              <p className="text-xs text-muted-foreground">
                The independent watchdog refreshes these settings every minute and uses its last saved settings
                during an outage.
              </p>
            </CardContent>
          </Card>
        )
      )}
    </>
  );
}
