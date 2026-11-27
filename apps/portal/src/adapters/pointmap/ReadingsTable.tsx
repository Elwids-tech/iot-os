import type { PointMap, PointMapReading } from "@iot-os/api-client";
import { Badge } from "@iot-os/ui/components/badge";
import { Button } from "@iot-os/ui/components/button";
import { SelectField } from "@iot-os/ui/components/form-fields";
import { Input } from "@iot-os/ui/components/input";
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@iot-os/ui/components/table";
import { Trash2Icon } from "lucide-react";
import { DEFAULT_RHYTHM_SECONDS, FASTEST_SAMPLE_MS, mapIssues, removeReading, renameReading } from "./model";

const numberOr = (text: string, fallback: number) => (text.trim() === "" || Number.isNaN(Number(text)) ? fallback : Number(text));

/**
 * Step two of a point map (spec 038 US3 scenarios 2 and 5): each reading's key, name,
 * unit, scale and offset, and how it reports. Defaults suit a building (FR-031).
 */
export function ReadingsTable({ map, onChange, disabled }: { map: PointMap; onChange: (map: PointMap) => void; disabled: boolean }) {
  const issues = mapIssues(map).filter((i) => i.key);
  const set = (key: string, patch: Partial<PointMapReading>) =>
    onChange({ ...map, readings: map.readings.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Readings</PanelTitle>
        <PanelDescription>
          Suggested from the server and yours to change. Numbers are sampled every 10 seconds and count as changed at 0.5% of their range; every point reports at least once per rhythm.
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <div className="max-w-xs">
          <SelectField
            label="Report at least every"
            value={String(map.rhythm_seconds)}
            onChange={(value) => onChange({ ...map, rhythm_seconds: Number(value) })}
            disabled={disabled}
            options={[60, 300, 900, 1800, 3600].map((s) => ({ value: String(s), label: s < 3600 ? `${s / 60} minute${s === 60 ? "" : "s"}` : "1 hour" }))}
            help={map.rhythm_seconds === DEFAULT_RHYTHM_SECONDS ? "The default; a steady device stays online." : "Devices go offline after a few missed reports."}
          />
        </div>
        <div className="overflow-x-auto">
          <Table aria-label="Readings">
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Scale</TableHead>
                <TableHead>Offset</TableHead>
                <TableHead>Sample (s)</TableHead>
                <TableHead>Counts as changed</TableHead>
                <TableHead>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {map.readings.map((reading, index) => {
                const label = (what: string) => `${what} of reading ${index + 1}`;
                const deadband = reading.report.deadband;
                return (
                  <TableRow key={index}>
                    <TableCell className="min-w-40">
                      <Input aria-label={label("Key")} value={reading.key} disabled={disabled} spellCheck={false} onChange={(e) => onChange(renameReading(map, reading.key, e.target.value))} />
                    </TableCell>
                    <TableCell className="min-w-48">
                      <Input aria-label={label("Name")} value={reading.name} disabled={disabled} onChange={(e) => set(reading.key, { name: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{reading.data_type}</Badge>
                    </TableCell>
                    <TableCell className="min-w-24">
                      <Input aria-label={label("Unit")} value={reading.unit ?? ""} disabled={disabled || reading.data_type !== "number"} onChange={(e) => set(reading.key, { unit: e.target.value || null })} />
                    </TableCell>
                    <TableCell className="min-w-20">
                      <Input aria-label={label("Scale")} inputMode="decimal" defaultValue={String(reading.scale ?? 1)} disabled={disabled || reading.data_type !== "number"} onBlur={(e) => set(reading.key, { scale: numberOr(e.target.value, 1) })} />
                    </TableCell>
                    <TableCell className="min-w-20">
                      <Input aria-label={label("Offset")} inputMode="decimal" defaultValue={String(reading.offset ?? 0)} disabled={disabled || reading.data_type !== "number"} onBlur={(e) => set(reading.key, { offset: numberOr(e.target.value, 0) })} />
                    </TableCell>
                    <TableCell className="min-w-20">
                      <Input
                        aria-label={label("Sample every, seconds")}
                        inputMode="numeric"
                        defaultValue={String(reading.report.sample_ms / 1000)}
                        disabled={disabled}
                        onBlur={(e) => set(reading.key, { report: { ...reading.report, sample_ms: Math.max(FASTEST_SAMPLE_MS, Math.round(numberOr(e.target.value, 10) * 1000)) } })}
                      />
                    </TableCell>
                    <TableCell className="min-w-56">
                      {reading.data_type === "number" ? (
                        <div className="flex items-center gap-2">
                          <SelectField
                            label={label("Counts as changed")}
                            labelHidden
                            value={deadband.kind}
                            disabled={disabled}
                            onChange={(kind) => set(reading.key, { report: { ...reading.report, deadband: { kind: kind as typeof deadband.kind, value: kind === "none" ? 0 : deadband.value || (kind === "percent" ? 0.5 : 1) } } })}
                            options={[
                              { value: "none", label: "Any change" },
                              { value: "percent", label: "% of range", disabled: !reading.range },
                              { value: "absolute", label: "By at least" },
                            ]}
                          />
                          {deadband.kind !== "none" && (
                            <Input
                              aria-label={label(deadband.kind === "percent" ? "Percent of range" : "Change of at least")}
                              className="w-20"
                              inputMode="decimal"
                              key={deadband.kind}
                              defaultValue={String(deadband.value)}
                              disabled={disabled}
                              onBlur={(e) => set(reading.key, { report: { ...reading.report, deadband: { ...deadband, value: Math.max(0, numberOr(e.target.value, 0)) } } })}
                            />
                          )}
                        </div>
                      ) : (
                        <span className="text-meta text-muted-foreground">Every change</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${reading.name || reading.key}`} disabled={disabled || map.readings.length === 1} onClick={() => onChange(removeReading(map, reading.key))}>
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {issues.length > 0 && (
          <ul className="flex flex-col gap-1 text-body text-destructive">
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.key}: {issue.problem}
              </li>
            ))}
          </ul>
        )}
      </PanelContent>
    </Panel>
  );
}
