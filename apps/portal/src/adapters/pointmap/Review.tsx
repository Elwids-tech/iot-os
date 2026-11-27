import { useState } from "react";
import type { DeviceAdapter, PointMap, PointMapCheck } from "@iot-os/api-client";
import { Alert, AlertDescription, AlertTitle } from "@iot-os/ui/components/alert";
import { Button } from "@iot-os/ui/components/button";
import { RelativeTime } from "@iot-os/ui/components/freshness";
import { SelectField } from "@iot-os/ui/components/form-fields";
import { Panel, PanelActions, PanelContent, PanelDescription, PanelFooter, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { Status, StatusMark } from "@iot-os/ui/components/status-mark";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table";
import { PropertyList } from "@iot-os/ui/templates/entity-page";
import { formatValue } from "../sources/opcua";
import { pointCount, rowsPerDay } from "./model";

/** A saved review check, or null when the revision has not been checked as an OPC UA map. */
export function checkOf(adapter: DeviceAdapter | undefined): PointMapCheck | null {
  const result = adapter?.revision.test_result as Partial<PointMapCheck> | null | undefined;
  return result && Array.isArray(result.equipment) && result.totals ? (result as PointMapCheck) : null;
}

/**
 * The review of a point map (spec 038 US3 scenario 7): how many devices, readings and
 * points it creates, the rows a day, a current value for each reading of one equipment,
 * and every problem. Only a revision that passed can be deployed (FR-024).
 */
export function Review({
  adapter,
  map,
  dirty,
  busy,
  canEdit,
  onCheck,
  onSave,
}: {
  adapter: DeviceAdapter | undefined;
  map: PointMap;
  dirty: boolean;
  busy: boolean;
  canEdit: boolean;
  onCheck: () => void;
  onSave: () => void;
}) {
  const check = dirty ? null : checkOf(adapter);
  const [shown, setShown] = useState(0);
  const equipment = check?.equipment[shown] ?? check?.equipment[0];
  const totals = check?.totals ?? { devices: map.equipment.length, readings: map.readings.length, points: pointCount(map), rows_per_day: rowsPerDay(map) };
  const names = new Map(map.readings.map((r) => [r.key, r.name]));
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader>
          <PanelTitle>Review</PanelTitle>
          <PanelDescription>
            The check finds every point on the server and reads it once. Only a revision that passed can start collecting.
            {check && adapter?.revision.tested_at && (
              <>
                {" "}Checked <RelativeTime at={adapter.revision.tested_at} />.
              </>
            )}
          </PanelDescription>
          <PanelActions>
            {dirty ? (
              <StatusMark tone="muted">Save to check</StatusMark>
            ) : check ? (
              <StatusMark tone={check.valid ? "good" : "critical"}>{check.valid ? "Passed" : `${check.problems.length} ${check.problems.length === 1 ? "problem" : "problems"}`}</StatusMark>
            ) : (
              <StatusMark tone="muted">Not checked</StatusMark>
            )}
          </PanelActions>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          <PropertyList
            items={[
              { label: "Devices", value: totals.devices.toLocaleString() },
              { label: "Readings each", value: totals.readings.toLocaleString() },
              { label: "Points", value: `${totals.points.toLocaleString()}${check ? ` of this organization's ${check.limit.max.toLocaleString()} (${check.limit.used.toLocaleString()} used by other data sources)` : ""}` },
              { label: "Rows a day", value: `At least ${totals.rows_per_day.toLocaleString()}, more when values change` },
            ]}
          />
          {check && check.problems.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>Fix these before collecting</AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {check.problems.map((problem, i) => (
                    <li key={i}>
                      {[problem.source_id?.split("/").at(-1), problem.key && (names.get(problem.key) ?? problem.key)].filter(Boolean).join(", ")}
                      {(problem.source_id || problem.key) && ": "}
                      {problem.problem}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </PanelContent>
        <PanelFooter className="justify-start gap-2">
          {dirty ? (
            <Button disabled={busy || !canEdit} onClick={onSave}>
              Save the point map
            </Button>
          ) : (
            <Button disabled={busy || !canEdit || !adapter} onClick={onCheck}>
              {busy ? "Checking…" : check ? "Check again" : "Check the point map"}
            </Button>
          )}
        </PanelFooter>
      </Panel>
      {check && equipment && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Current values</PanelTitle>
            <PanelDescription>What each reading would store now. Bad quality is stored as unknown with its reason.</PanelDescription>
            {check.equipment.length > 1 && (
              <PanelActions>
                <SelectField
                  label="Equipment"
                  labelHidden
                  value={String(Math.min(shown, check.equipment.length - 1))}
                  onChange={(value) => setShown(Number(value))}
                  options={check.equipment.slice(0, 500).map((e, i) => ({ value: String(i), label: e.display_name }))}
                />
              </PanelActions>
            )}
          </PanelHeader>
          <PanelContent>
            <div className="overflow-x-auto">
              <Table aria-label={`Current values of ${equipment.display_name}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reading</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Server time</TableHead>
                    <TableHead>Problem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.readings.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{names.get(row.key) ?? row.key}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.quality === "bad" ? "Unknown" : formatValue({ ...row, node_id: "", namespace_uri: "", status: row.status ?? "", quality: row.quality ?? "good" })}</TableCell>
                      <TableCell>{row.quality ? <Status value={row.quality} domain="opcua_quality" title={row.reason ?? row.status ?? undefined} /> : null}</TableCell>
                      <TableCell>{row.source_time ? <RelativeTime at={row.source_time} /> : null}</TableCell>
                      <TableCell className="text-destructive">{row.problem}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </PanelContent>
        </Panel>
      )}
    </div>
  );
}
