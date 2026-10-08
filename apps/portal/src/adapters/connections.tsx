import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type {
  AdapterCandidate,
  AdapterKit,
  DeviceAdapter,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Badge } from "@iot-os/ui/components/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@iot-os/ui/components/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@iot-os/ui/components/field";
import { Input } from "@iot-os/ui/components/input";
import { Alert, AlertDescription } from "@iot-os/ui/components/alert";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iot-os/ui/components/table";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@iot-os/ui/components/alert-dialog";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";

function download(kit: AdapterKit) {
  const bytes = kit.archive_base64
    ? Uint8Array.from(atob(kit.archive_base64), (c) => c.charCodeAt(0))
    : JSON.stringify(kit, null, 2);
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: kit.archive_base64 ? "application/zip" : "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = kit.filename ?? `device-connection-${kit.credential_uuid}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AdapterCredentials({
  org,
  adapter,
  disabled,
}: {
  org: string;
  adapter: DeviceAdapter;
  disabled: boolean;
}) {
  const cache = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    id: string;
    action: "rotate" | "revoke";
  } | null>(null);
  const query = useQuery({
    queryKey: ["adapter-credentials", org, adapter.uuid],
    queryFn: () => api.adapterCredentials(org, adapter.uuid),
    enabled: !disabled,
  });
  async function action(
    id?: string,
    kind: "kit" | "rotate" | "revoke" = "kit",
  ) {
    setBusy(true);
    setError(null);
    try {
      if (id && kind === "revoke")
        await api.revokeAdapterCredential(org, adapter.uuid, id);
      else
        download(
          id
            ? await api.adapterConnectionKit(
                org,
                adapter.uuid,
                id,
                kind === "rotate" ? "rotate" : "kit",
              )
            : await api.createAdapterCredential(org, adapter.uuid, name),
        );
      setName("");
      setConfirmation(null);
      await cache.invalidateQueries({
        queryKey: ["adapter-credentials", org, adapter.uuid],
      });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hardware connection kits</CardTitle>
        <CardDescription>
          Give each physical device its own revocable credentials. The kit
          contains the MQTT endpoint, username, password, CA certificate and
          allowed topics.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="hardware-credential-name">
              Hardware credential label
            </FieldLabel>
            <Input
              id="hardware-credential-name"
              placeholder="Meter WM-1042"
              value={name}
              disabled={disabled || busy}
              onChange={(e) => setName(e.target.value)}
            />
            <FieldDescription>
              Store downloaded kits securely. Passwords are excluded from
              adapter drafts and AI context.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <RequestError error={error || query.error} />
        {query.data?.map((credential) => (
          <div
            key={credential.uuid}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="mr-auto">{credential.name}</span>
            <Badge variant="outline">
              {credential.revoked_at ? "Revoked" : "Active"}
            </Badge>
            {!credential.revoked_at && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() => void action(credential.uuid)}
                >
                  Download kit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() =>
                    setConfirmation({ id: credential.uuid, action: "rotate" })
                  }
                >
                  Rotate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() =>
                    setConfirmation({ id: credential.uuid, action: "revoke" })
                  }
                >
                  Revoke
                </Button>
              </>
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <Button
          disabled={disabled || busy || !name.trim()}
          onClick={() => void action()}
        >
          Create & download kit
        </Button>
      </CardFooter>
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.action === "rotate"
                ? "Rotate hardware credentials?"
                : "Revoke hardware credentials?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.action === "rotate"
                ? "The old password will stop working. A new connection kit will download; configure the hardware with it to resume publishing."
                : "The hardware will lose broker access. Its platform device and historical readings remain available."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RequestError error={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              disabled={busy}
              onClick={() =>
                confirmation &&
                void action(confirmation.id, confirmation.action)
              }
            >
              {confirmation?.action === "rotate"
                ? "Rotate & download"
                : "Revoke access"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function AdapterDevices({
  org,
  adapter,
  canActivate,
}: {
  org: string;
  adapter: DeviceAdapter;
  canActivate: boolean;
}) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["adapter-candidates", org, adapter.uuid],
    queryFn: () => api.adapterCandidates(org, adapter.uuid),
    refetchInterval: 3000,
  });
  const [selected, setSelected] = useState<AdapterCandidate | null>(null);
  const [name, setName] = useState("");
  const [device, setDevice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const devices = useQuery({
    queryKey: ["adapter-link-devices", org, search, page],
    queryFn: () =>
      api.devices(org, { search, page, lifecycle: "registered", per_page: 20 }),
    enabled: !!selected,
  });
  async function activate() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.activateAdapterCandidate(org, adapter.uuid, selected.uuid, {
        name,
        ...(device ? { device_uuid: device } : {}),
      });
      setSelected(null);
      await cache.invalidateQueries({
        queryKey: ["adapter-candidates", org, adapter.uuid],
      });
      await cache.invalidateQueries({
        queryKey: ["adapter", org, adapter.uuid],
      });
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review discovered physical devices</CardTitle>
        <CardDescription>
          Unknown serials produce previews. Activate a serial to store its
          telemetry against a stable virtual device ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertDescription>
            Link an inactive virtual device or create one. Replacement of active
            hardware and counter offsets are planned as a separate workflow.
          </AlertDescription>
        </Alert>
        <RequestError error={query.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Manufacturer serial</TableHead>
              <TableHead>Latest preview</TableHead>
              <TableHead>Platform device</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data?.map((c) => (
              <TableRow key={c.uuid}>
                <TableCell>
                  {c.source_device_id}
                  <p className="text-xs text-muted-foreground">
                    {c.preview.retained ? "Retained preview" : "Live preview"}
                  </p>
                </TableCell>
                <TableCell>
                  {c.preview.metrics?.map((m) => (
                    <p key={m.name} className="text-sm">
                      {m.name}: {String(m.value)} {m.unit}
                    </p>
                  ))}
                </TableCell>
                <TableCell>
                  {c.device ? (
                    <Link
                      className="underline"
                      to={`/organizations/${org}/devices/${c.device.uuid}/overview`}
                    >
                      {c.device.name}
                    </Link>
                  ) : (
                    "Awaiting review"
                  )}
                </TableCell>
                <TableCell>
                  {c.device ? (
                    <Badge variant="secondary">
                      Linked · {c.device.lifecycle}
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        !canActivate ||
                        adapter.status !== "running" ||
                        !!c.preview.retained
                      }
                      onClick={() => {
                        setSelected(c);
                        setName(c.source_device_id);
                        setDevice("");
                        setError(null);
                      }}
                    >
                      Review & activate
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!query.data?.length && (
          <p className="text-sm text-muted-foreground">
            No serials received yet. Deploy the adapter, connect the hardware,
            and publish a live sample.
          </p>
        )}
      </CardContent>
      <AlertDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Activate {selected?.source_device_id}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Confirm the virtual device that will own this physical device’s
              readings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <SearchableSelect
              label="Platform device"
              value={device}
              options={[
                { value: "", label: "Create a new virtual device" },
                ...(devices.data?.data ?? [])
                  .filter(
                    (d) =>
                      !d.applied_configuration_uuid &&
                      !d.desired_configuration_uuid,
                  )
                  .map((d) => ({
                    value: d.uuid,
                    label: `${d.name} · ${d.code}`,
                  })),
              ]}
              search={search}
              onSearchChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              onChange={setDevice}
              loading={devices.isPending}
              page={page}
              onPageChange={setPage}
              hasNextPage={
                !!devices.data &&
                devices.data.meta.current_page < devices.data.meta.last_page
              }
            />
            <Field>
              <FieldLabel htmlFor="adapter-device-name">Device name</FieldLabel>
              <Input
                id="adapter-device-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </Field>
          </FieldGroup>
          <RequestError error={error || devices.error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              Keep reviewing
            </AlertDialogCancel>
            <Button
              disabled={busy || !name.trim()}
              onClick={() => void activate()}
            >
              Activate & start storing
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
