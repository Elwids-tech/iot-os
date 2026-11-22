import type { ReactNode } from "react";
import type { DeviceAdapter } from "@iot-os/api-client";
import { ArrowRightIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import { Button } from "@iot-os/ui/components/button";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import {
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from "@iot-os/ui/components/panel";
import { Status, StatusMark, type StatusTone } from "@iot-os/ui/components/status-mark";
import { statusOf } from "@iot-os/ui/lib/status";
import { PropertyList } from "@iot-os/ui/templates/entity-page";
import { isMqtt, sourceLabel } from "./source";

/** A health flag older than 30 s says nothing about now. */
export function connectionStatus(
  adapter: DeviceAdapter,
  field: "source_connected" | "upstream_connected",
) {
  const checked = Date.parse(adapter.health?.checked_at ?? "");
  if (!Number.isFinite(checked) || Date.now() - checked > 30000)
    return "unknown";
  return adapter.health?.[field] ? "connected" : "not connected";
}

const connectionTone: Record<ReturnType<typeof connectionStatus>, StatusTone> = {
  connected: "good",
  "not connected": "critical",
  unknown: "muted",
};

/**
 * A live adapter at a glance: where the data comes from, what decodes it and which devices it
 * feeds, each opening its tab. A saved draft that is not running yet is the one thing to act on.
 */
export function AdapterOverview({
  adapter,
  applied,
  tested,
  summary,
  onOpen,
}: {
  adapter: DeviceAdapter;
  /** The revision number the runtime runs, or null before the first deployment. */
  applied: number | null;
  /** The saved draft passed its sample tests. */
  tested: boolean;
  /** The source in a sentence. */
  summary: string;
  onOpen: (tab: string) => void;
}) {
  const draftWaiting =
    adapter.revision.uuid !== adapter.applied_revision_uuid && adapter.status !== "pending";
  const source = isMqtt(adapter.source)
    ? { tone: connectionTone[connectionStatus(adapter, "source_connected")], label: `Broker ${connectionStatus(adapter, "source_connected")}` }
    : {
        tone: statusOf(adapter.source_state?.state, "source").tone,
        label: adapter.source_state?.label || statusOf(adapter.source_state?.state, "source").label,
      };
  const devices = adapter.checklist?.find((item) => item.step === "activate");
  return (
    <div className="flex flex-col gap-4">
      {draftWaiting && (
        <Alert>
          <AlertTitle>Draft {adapter.draft_revision} is not live yet</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="min-w-0 flex-1">
              {applied === null ? "Nothing is deployed." : `Devices still use revision ${applied}.`}{" "}
              {tested ? "The draft passes its sample tests." : "Run its sample tests before deploying."}
            </span>
            <Button size="sm" onClick={() => onOpen(tested ? "deploy" : "decoder")}>
              {tested ? "Review and deploy" : "Open the decoder"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Panel aria-label="How data flows">
        <ol className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
          <Stage
            label="Source"
            title={sourceLabel(adapter.source.type)}
            onOpen={() => onOpen("source")}
          >
            <StatusMark tone={source.tone}>{source.label}</StatusMark>
            {adapter.health?.last_message_at && (
              <span className="text-muted-foreground">
                Last message <RelativeTime at={adapter.health.last_message_at} />
              </span>
            )}
          </Stage>
          <Stage
            label="Decoder"
            title={applied === null ? "Not deployed" : `Revision ${applied}`}
            onOpen={() => onOpen("decoder")}
          >
            <Status value={adapter.status} />
            <span className="text-muted-foreground">Into {adapter.profile_name}</span>
          </Stage>
          <Stage
            label="Devices"
            title={devices?.detail ?? "Discovered serials"}
            onOpen={() => onOpen("devices")}
          >
            {devices && devices.state !== "done" ? (
              <Status value={devices.state} domain="checklist" />
            ) : (
              <span className="text-muted-foreground">Review and activate serials as they appear</span>
            )}
          </Stage>
        </ol>
      </Panel>
      <Panel>
        <PanelHeader>
          <PanelTitle>About</PanelTitle>
        </PanelHeader>
        <PanelContent>
          <PropertyList
            items={[
              { label: "Device type", value: adapter.profile_name },
              { label: "Source", value: sentence(summary) },
              {
                label: "Publisher",
                value: (
                  <StatusMark tone={connectionTone[connectionStatus(adapter, "upstream_connected")]}>
                    {sentence(connectionStatus(adapter, "upstream_connected"))}
                  </StatusMark>
                ),
              },
              {
                label: "Revisions",
                value: `Draft ${adapter.draft_revision} · ${applied === null ? "none live" : `revision ${applied} live`}`,
              },
            ]}
          />
        </PanelContent>
      </Panel>
    </div>
  );
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Stage({
  label,
  title,
  onOpen,
  children,
}: {
  label: string;
  title: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col items-start gap-1.5 p-4 text-body">
      <span className="text-meta text-muted-foreground">{label}</span>
      <Button
        variant="link"
        className="link-target h-auto gap-1 p-0 text-heading text-foreground"
        onClick={onOpen}
      >
        {title}
        <ArrowRightIcon aria-hidden="true" />
      </Button>
      {children}
    </li>
  );
}
