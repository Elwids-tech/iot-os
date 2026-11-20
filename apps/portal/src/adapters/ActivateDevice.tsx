import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AdapterLastReport, Device } from "@iot-os/api-client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@iot-os/ui/components/alert-dialog";
import { Button } from "@iot-os/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@iot-os/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@iot-os/ui/components/field";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import { Input } from "@iot-os/ui/components/input";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import { api } from "../lib/api";
import { RequestError } from "../components/forms";

/**
 * Activates one manufacturer serial an adapter decoded, in one step: a new device
 * named after the serial (or an inactive registered one) gets every reading of the
 * adapter's profile the source has reported mapped and applied, tied to the adapter. Discovery, Add device,
 * the adapter's Devices tab and the onboarding assistant all open this; adapter
 * sources never go through manual mapping. When the source has already reported, Activate
 * asks whether its last report becomes the device's first readings (kept with the time the
 * source observed them) or the device starts from its next report.
 */
export function ActivateAdapterDevice({
  org,
  adapter,
  candidate,
  serial,
  onClose,
  onActivated,
}: {
  org: string;
  adapter: { uuid: string; name: string };
  /** The adapter's candidate for this serial. */
  candidate: string;
  serial: string;
  onClose: () => void;
  onActivated?: (device: Device) => void;
}) {
  const cache = useQueryClient();
  const [name, setName] = useState(serial);
  const [device, setDevice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const lastReport = useQuery({
    queryKey: ["adapter-last-report", org, adapter.uuid, candidate],
    queryFn: () => api.adapterLastReport(org, adapter.uuid, candidate),
  });
  const kept = lastReport.data?.readings ?? [];
  const devices = useQuery({
    queryKey: ["adapter-link-devices", org, search, page],
    queryFn: () => api.devices(org, { search, page, lifecycle: "registered", per_page: 20 }),
  });
  async function activate(keepLastReadings: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.activateAdapterCandidate(org, adapter.uuid, candidate, {
        name: name.trim(),
        ...(device ? { device_uuid: device } : {}),
        keep_last_readings: keepLastReadings,
      });
      await Promise.all(
        [["adapter-candidates", org, adapter.uuid], ["adapter", org, adapter.uuid], ["discovery-directory", org], ["devices", org]].map(
          (queryKey) => cache.invalidateQueries({ queryKey }),
        ),
      );
      toast.success(`Activated ${serial} as ${result.device.name}`);
      onActivated?.(result.device);
      onClose();
    } catch (reason) {
      setError(reason);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activate {serial}</DialogTitle>
          <DialogDescription>
            {adapter.name} decodes this device, so the readings it reports are mapped from the adapter’s profile and stored from now
            on. There is nothing else to set up.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !name.trim()) return;
            // Nothing to keep (or the report could not be read): activate from the next report.
            if (kept.length > 0) setConfirming(true);
            else void activate(false);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="activate-device-name">Device name</FieldLabel>
              <Input id="activate-device-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </Field>
            <SearchableSelect
              label="Platform device"
              value={device}
              options={[
                { value: "", label: "Create a new device" },
                ...(devices.data?.data ?? [])
                  .filter((d) => !d.applied_configuration_uuid && !d.desired_configuration_uuid)
                  .map((d) => ({ value: d.uuid, label: `${d.name} · ${d.code}` })),
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
              hasNextPage={!!devices.data && devices.data.meta.current_page < devices.data.meta.last_page}
            />
          </FieldGroup>
          <RequestError error={error || devices.error} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || lastReport.isPending}>
              {busy ? "Activating…" : "Activate"}
            </Button>
          </DialogFooter>
        </form>
        <KeepLastReport
          open={confirming}
          serial={serial}
          report={lastReport.data}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onChoose={(keep) => void activate(keep)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Asks whether the source's last report becomes the device's first readings. */
function KeepLastReport({
  open,
  serial,
  report,
  busy,
  onCancel,
  onChoose,
}: {
  open: boolean;
  serial: string;
  report: AdapterLastReport | undefined;
  busy: boolean;
  onCancel: () => void;
  onChoose: (keep: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Keep what {serial} last reported?</AlertDialogTitle>
          <AlertDialogDescription>
            It last reported <RelativeTime at={report?.observed_at} />. Keep these as the device’s first readings, at the time it
            observed them, or start from its next report.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta">
          {report?.readings.map((reading) => (
            <div key={reading.key} className="contents">
              <dt className="text-muted-foreground">{reading.label}</dt>
              <dd className="tabular-nums">
                {String(reading.value)}
                {reading.unit ? ` ${reading.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
          <Button variant="outline" disabled={busy} onClick={() => onChoose(false)}>
            Start from next report
          </Button>
          <Button disabled={busy} onClick={() => onChoose(true)}>
            {busy ? "Activating…" : "Keep and activate"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
