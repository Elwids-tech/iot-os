import { useState } from "react";
import type { DeviceConnectionKit, DeviceOnboarding } from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Checkbox } from "@iot-os/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@iot-os/ui/components/field";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@iot-os/ui/components/accordion";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@iot-os/ui/components/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@iot-os/ui/components/table";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";
import { downloadFile, saveArchive } from "../lib/download";
import { FirmwareTargetSelect, useFirmwareTargets } from "../lib/firmware";

export function ConnectionKit({
  org,
  setup,
  canDownload,
  onProvisioned,
}: {
  org: string;
  setup: DeviceOnboarding;
  canDownload: boolean;
  onProvisioned: () => void;
}) {
  // Credentials are deliberately never placed in query caches, browser storage, URLs, or logs.
  const [kit, setKit] = useState<DeviceConnectionKit | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(""),
    [reveal, setReveal] = useState(false);
  async function obtain(download: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!setup.provisioned) {
        const result = await api.provisionDeviceOnboarding(
          org,
          setup.device.uuid,
        );
        onProvisioned();
        if (!result.provisioned)
          throw new Error(
            result.diagnostic ?? "Connection setup is not ready. Please retry.",
          );
      }
      const result = await api.deviceConnectionKit(org, setup.device.uuid);
      setKit(result);
      if (download) {
        const link = document.createElement("a");
        link.href = api.deviceConnectionKitArchiveUrl(org, setup.device.uuid);
        link.download = result.filename;
        document.body.append(link);
        link.click();
        link.remove();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch (e) {
      setError(e);
    }
  }
  const endpoint = new URL(setup.broker_url);
  if (setup.mode === "gateway")
    return (
      <div className="flex flex-col gap-6">
        <h2 className="text-lg font-semibold">
          Add this device to {setup.gateway.name}
        </h2>
        <p className="text-sm text-muted-foreground">
          Your gateway already owns the MQTT connection. Configure its Sparkplug
          publisher to announce this downstream device using the identifiers
          below.
        </p>
        <Table>
          <TableBody>
            {[
              ["Group ID", setup.gateway.group_id],
              ["Edge Node ID", setup.gateway.edge_node_id],
              ["Device ID", setup.source_device_id],
            ].map(([k, v]) => (
              <TableRow key={k}>
                <TableCell>{k}</TableCell>
                <TableCell className="break-all font-mono text-xs">
                  {v}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-sm">
          Publish a DBIRTH message, followed by DDATA messages, with the
          measurements listed below. Ask the gateway owner to apply these
          settings if you do not manage it.
        </p>
        <ExpectedMetrics setup={setup} />
      </div>
    );
  return (
    <div className="flex flex-col gap-6">
      <RequestError error={error} />
      {setup.diagnostic && (
        <Alert>
          <AlertTitle>Connection setup needs attention</AlertTitle>
          <AlertDescription>{setup.diagnostic}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col items-start gap-3">
        <h2 className="font-semibold">1. Download your setup bundle</h2>
        <p className="text-sm text-muted-foreground">
          Your device configuration, CA certificate, and step-by-step guide in
          one ZIP file.
        </p>
        <Button
          onClick={() => void obtain(true)}
          disabled={busy || !canDownload}
        >
          <DownloadIcon data-icon="inline-start" />
          {busy ? "Preparing connection kit…" : "Download setup bundle"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Includes device-config.json · ca.crt · quickstart.md
        </p>
        {kit && <a className="text-sm text-primary underline underline-offset-4" href={api.deviceConnectionKitArchiveUrl(org, setup.device.uuid)}>Download ZIP again</a>}
        {!canDownload && (
          <p className="text-sm">
            Ask an administrator with connection-management access to download
            this kit.
          </p>
        )}
        <WritingFirmware
          org={org}
          setup={setup}
          canDownload={canDownload}
          onProvisioned={onProvisioned}
        />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">
          2. Install the settings and start your device
        </h2>
        <p className="text-sm text-muted-foreground">
          Extract the bundle and apply it to your Sparkplug B publisher. Keep
          TLS certificate verification enabled. Return here when the device is
          powered on and publishing.
        </p>
      </div>
      {["localhost", "127.0.0.1", "::1", "[::1]"].includes(
        endpoint.hostname,
      ) && (
        <Alert>
          <AlertTitle>This endpoint is local to this computer</AlertTitle>
          <AlertDescription>
            A simulator on this computer can use {endpoint.hostname}. For
            separate hardware, an administrator must configure a reachable
            broker hostname covered by its TLS certificate.
          </AlertDescription>
        </Alert>
      )}
      <Accordion type="multiple">
        <AccordionItem value="manual">
          <AccordionTrigger>
            Prefer to enter settings manually?
          </AccordionTrigger>
          <AccordionContent>
            {!kit ? (
              <Button
                variant="outline"
                disabled={!canDownload || busy}
                onClick={() => void obtain(false)}
              >
                Load connection details
              </Button>
            ) : (
              <div className="flex flex-col gap-3">
                <Table>
                  <TableBody>
                    {[
                      ["Broker address", endpoint.hostname],
                      ["Port", endpoint.port || "8883"],
                      ["Client ID", kit.config.client_id],
                      ["Username", kit.config.username],
                      ["Password", kit.config.password],
                    ].map(([label, value]) => (
                      <TableRow key={label}>
                        <TableCell>{label}</TableCell>
                        <TableCell className="break-all font-mono text-xs">
                          {label === "Password" && !reveal
                            ? "••••••••••••••••"
                            : value}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Copy ${label.toLowerCase()}`}
                            onClick={() => void copy(label, value)}
                          >
                            <CopyIcon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReveal(!reveal)}
                  >
                    {reveal ? "Hide password" : "Reveal password"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadFile(
                        "ca.crt",
                        kit.ca_certificate,
                        "application/x-pem-file",
                      )
                    }
                  >
                    Download CA certificate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setKit(null);
                      setReveal(false);
                    }}
                  >
                    Hide connection details
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground" role="status">
                  {copied && `${copied} copied`}
                </span>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="sparkplug">
          <AccordionTrigger>
            Sparkplug identifiers and expected measurements
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-4">
              <p className="break-all text-sm">
                Group: <code>{setup.gateway.group_id}</code>
                <br />
                Edge Node: <code>{setup.gateway.edge_node_id}</code>
              </p>
              <p className="text-sm text-muted-foreground">
                This device acts as its own Edge Node. Announce its measurements
                in NBIRTH and send updates in NDATA. The guide includes
                lifecycle and rebirth requirements.
              </p>
              <ExpectedMetrics setup={setup} />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <p className="text-xs text-muted-foreground">
        Keep this bundle private. It contains the credentials for this
        connection.
      </p>
    </div>
  );
}

/**
 * "I'm writing the firmware" (spec 027 US4): a credential-free starter for the device's
 * profile for anyone at this step, and its firmware kit (the starter with this device's
 * connection settings) for people who may manage connections.
 */
function WritingFirmware({
  org,
  setup,
  canDownload,
  onProvisioned,
}: {
  org: string;
  setup: DeviceOnboarding;
  canDownload: boolean;
  onProvisioned: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState<"starter" | "kit" | null>(null),
    [error, setError] = useState<unknown>(null),
    [done, setDone] = useState("");
  const targets = useFirmwareTargets(org, "direct", writing);
  async function download(kind: "starter" | "kit") {
    if (busy || !target) return;
    setBusy(kind);
    setError(null);
    setDone("");
    try {
      if (kind === "starter") {
        saveArchive(
          await api.createFirmwareStarter(org, {
            target,
            role: "direct",
            node_artifact_uuid: setup.artifact.uuid,
          }),
        );
        setDone("Starter downloaded.");
        return;
      }
      if (!setup.provisioned) {
        const result = await api.provisionDeviceOnboarding(
          org,
          setup.device.uuid,
        );
        onProvisioned();
        if (!result.provisioned)
          throw new Error(
            result.diagnostic ?? "Connection setup is not ready. Please retry.",
          );
      }
      // The archive stays in this function: it holds the device's credentials.
      saveArchive(await api.deviceFirmwareKit(org, setup.device.uuid, target));
      setDone(
        "Firmware kit downloaded. Its config/ folder holds the credentials: keep it private.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mt-3 flex w-full flex-col gap-3">
      <Field orientation="horizontal">
        <Checkbox
          id="writing-firmware"
          checked={writing}
          onCheckedChange={(checked) => setWriting(checked === true)}
        />
        <FieldContent>
          <FieldLabel htmlFor="writing-firmware">
            I’m writing the firmware
          </FieldLabel>
          <FieldDescription>
            Get a starter project with the IoT OS SDK and this profile's
            metrics, ready for you or an AI coding agent.
          </FieldDescription>
        </FieldContent>
      </Field>
      {writing && (
        <div className="flex flex-col items-start gap-3 pl-7">
          <Field className="max-w-sm">
            <FieldLabel htmlFor="onboarding-firmware-target">
              Microcontroller or platform
            </FieldLabel>
            <FirmwareTargetSelect
              id="onboarding-firmware-target"
              targets={targets.options}
              value={target}
              onChange={setTarget}
              loading={targets.isPending}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!target || busy !== null}
              onClick={() => void download("starter")}
            >
              <DownloadIcon data-icon="inline-start" />
              {busy === "starter" ? "Preparing…" : "Download starter"}
            </Button>
            {canDownload && (
              <Button
                variant="outline"
                disabled={!target || busy !== null}
                onClick={() => void download("kit")}
              >
                <DownloadIcon data-icon="inline-start" />
                {busy === "kit" ? "Preparing…" : "Download firmware kit"}
              </Button>
            )}
          </div>
          <p className="text-meta text-muted-foreground">
            {canDownload
              ? "The starter holds no credentials. The firmware kit adds this device's connection settings in config/: keep it private."
              : "The starter holds no credentials. Its connection settings come from an administrator."}
          </p>
          <RequestError error={error ?? targets.error} />
          <p role="status" className="text-meta">
            {done}
          </p>
        </div>
      )}
    </div>
  );
}

function ExpectedMetrics({ setup }: { setup: DeviceOnboarding }) {
  return (
    <Table>
      <TableBody>
        {setup.artifact.definition.parameters
          .filter((p) => p.reports_state && p.kind !== "derived")
          .map((p) => (
            <TableRow key={p.uuid}>
              <TableCell>{p.label}</TableCell>
              <TableCell className="font-mono text-xs">{p.key}</TableCell>
              <TableCell>
                {p.data_type} · {p.unit ?? "No unit"}
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
