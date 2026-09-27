import { describe, expect, it, vi } from "vitest";
import type {
  DashboardSource,
  DeviceDetail,
  Measurement,
} from "@iot-os/api-client";
import {
  absoluteError,
  appendLayout,
  appliedParameters,
  bandFor,
  cleanLayouts,
  dateInput,
  DEFAULT_VIEW,
  gaugeSegments,
  inputDate,
  newWidget,
  profilePrecision,
  seriesColor,
  seriesStats,
  tickFormatter,
  toCsv,
  readView,
  resolveRange,
  responsiveLayouts,
  thresholdError,
  widgetError,
  writeView,
} from "./model";
import { createRequestQueue } from "./requests";

const source: DashboardSource = {
  device_uuid: "device",
  parameter_uuid: "parameter",
  label: "Temperature",
  unit: "C",
  data_type: "number",
  precision: null,
  color: "#2563eb",
  base: { label: "Below range", color: "#64748b" },
  thresholds: [-10, 0, 20, 40, 80].map((value) => ({
    value,
    label: String(value),
    color: "#2563eb",
  })),
};
const reading = (value: number, quality: Measurement["quality"] = "good") =>
  ({ value, quality }) as Measurement;
describe("per-parameter thresholds", () => {
  it("supports more than three bands, negatives, and inclusive lower boundaries", () => {
    expect(bandFor(source, reading(-11)).label).toBe("Below range");
    expect(bandFor(source, reading(-10)).label).toBe("-10");
    expect(bandFor(source, reading(19.99)).label).toBe("0");
    expect(bandFor(source, reading(20)).label).toBe("20");
    expect(bandFor(source, reading(900)).label).toBe("80");
  });
  it("prioritizes measurement quality and handles no reading", () => {
    for (const state of ["stale", "invalid", "inactive"] as const)
      expect(bandFor(source, reading(20, state)).label).toBe(state);
    expect(bandFor(source).label).toBe("No reading");
  });
  it("rejects duplicate and non-finite boundaries", () => {
    expect(
      thresholdError({
        ...source,
        thresholds: [source.thresholds[0], source.thresholds[0]],
      }),
    ).toMatch(/unique/);
    expect(
      thresholdError({
        ...source,
        thresholds: [{ ...source.thresholds[0], value: NaN }],
      }),
    ).toMatch(/finite/);
    expect(thresholdError(source)).toBeNull();
  });
  it("creates panels without domain-specific rules and validates chart units", () => {
    const panel = newWidget("timeseries");
    expect(panel.config.sources).toEqual([]);
    panel.config.sources = [
      source,
      { ...source, parameter_uuid: "another", unit: "V" },
    ];
    expect(widgetError(panel)).toMatch(/same unit/);
    panel.config.sources[1].unit = "C";
    expect(widgetError(panel)).toBeNull();
  });
  it("defaults new control panels to a responsive card grid", () => {
    expect(newWidget("controls").config.columns).toBe("auto");
    expect(newWidget("status").config.columns).toBeUndefined();
  });
});
describe("historical viewing state", () => {
  it("rolls relative ranges but never moves absolute ranges", () => {
    const at = Date.parse("2026-09-09T12:00:00Z");
    const window = resolveRange(DEFAULT_VIEW.range, at);
    expect(window).toEqual({
      from: "2026-09-09T06:00:00.000Z",
      to: "2026-09-09T12:00:00.000Z",
    });
    expect(resolveRange({ mode: "absolute", ...window }, at + 10000)).toEqual(
      window,
    );
  });
  it("round trips independent URL overrides without mutating saved defaults", () => {
    const before = structuredClone(DEFAULT_VIEW);
    const value = {
      ...DEFAULT_VIEW,
      timezone: "utc" as const,
      refresh: 0 as const,
      range: {
        mode: "absolute" as const,
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-02T00:00:00.000Z",
      },
    };
    const params = writeView(new URLSearchParams("keep=yes&range=6h"), value);
    expect(readView(params, DEFAULT_VIEW)).toEqual(value);
    expect(params.get("keep")).toBe("yes");
    expect(params.has("range")).toBe(false);
    expect(DEFAULT_VIEW).toEqual(before);
    expect(readView(new URLSearchParams(), DEFAULT_VIEW)).toEqual(before);
  });
  it("validates ordering, future times, and maximum intervals", () => {
    expect(absoluteError("bad", "bad")).toMatch(/valid/);
    expect(absoluteError("2026-01-02", "2026-01-01")).toMatch(/after/);
    expect(absoluteError("2026-01-01", "2099-01-01")).toMatch(/future/);
    expect(absoluteError("2025-01-01", "2026-01-01")).toMatch(/90 days/);
  });
  it("converts UTC and local inputs using the date-specific offset", () => {
    const iso = "2026-01-15T12:30:45.000Z";
    expect(inputDate(dateInput(iso, "utc"), "utc")).toBe(iso);
    expect(inputDate(dateInput(iso, "browser"), "browser")).toBe(iso);
    expect(inputDate("not a date", "browser")).toBe("");
  });
});
describe("configuration and layout", () => {
  it("scales missing breakpoints without changing saved layouts", () => {
    const layout = {
      lg: [
        { i: "one", x: 0, y: 0, w: 6, h: 6 },
        { i: "two", x: 6, y: 0, w: 6, h: 6 },
      ],
    };
    const result = responsiveLayouts(layout);
    expect(result.md?.map((i) => [i.x, i.w, i.y])).toEqual([
      [0, 5, 0],
      [5, 5, 0],
    ]);
    expect(result.xs?.map((i) => [i.x, i.w, i.y])).toEqual([
      [0, 1, 0],
      [0, 1, 6],
    ]);
    expect(result.lg).toEqual(layout.lg);
    expect(Object.keys(layout)).toEqual(["lg"]);
  });
  it("offers last-applied parameters without latest telemetry", () => {
    const device = {
      applied_configuration_uuid: null,
      last_applied_configuration_uuid: "previous",
      configurations: [
        {
          uuid: "previous",
          definition: {
            profile_canonical_json: JSON.stringify({
              parameters: [{ uuid: "p", label: "Awaiting measurement" }],
            }),
          },
        },
      ],
    } as unknown as DeviceDetail;
    expect(appliedParameters(device)[0].label).toBe("Awaiting measurement");
  });
  it("preserves layout IDs and appends independently at each breakpoint", () => {
    const original = {
      lg: [{ i: "one", x: 0, y: 0, w: 6, h: 5 }],
      xs: [{ i: "one", x: 0, y: 0, w: 1, h: 5 }],
    };
    const next = appendLayout(original, "two");
    expect(next.lg?.[1]).toEqual({ i: "two", x: 6, y: 0, w: 6, h: 6 });
    expect(next.xs?.[1].w).toBe(1);
    expect(original.lg).toHaveLength(1);
    expect(cleanLayouts(next)).toEqual(next);
  });
  it("adds below all panels at every breakpoint even when earlier gaps exist", () => {
    const layouts = {
      lg: [{ i: "one", x: 0, y: 20, w: 6, h: 6 }],
      xs: [{ i: "one", x: 0, y: 40, w: 1, h: 8 }],
    };
    const result = appendLayout(layouts, "two", "bottom");
    expect(result.lg?.[1]).toEqual({ i: "two", x: 0, y: 26, w: 6, h: 6 });
    expect(result.xs?.[1]).toEqual({ i: "two", x: 0, y: 48, w: 1, h: 6 });
    expect(layouts.lg).toHaveLength(1);
  });
});
it("bounds concurrent requests and removes aborted queued work", async () => {
  const run = createRequestQueue(1),
    controller = new AbortController();
  let release!: () => void;
  const first = run(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const request = vi.fn(async () => 1);
  const second = run(controller.signal, request);
  const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  release();
  await first;
  expect(request).not.toHaveBeenCalled();
  await expect(run(new AbortController().signal, async () => 2)).resolves.toBe(
    2,
  );
});

import {
  locationPresentation,
  type LocationOverviewData,
} from "@iot-os/ui/components/workflow-overview";
const overview: LocationOverviewData = {
  workflow_name: "Boundary",
  deployment_status: "active",
  snapshot: {
    evaluated_at: "2026-09-25T00:00:00Z",
    max_age_seconds: 60,
    geometry: { coordinates: [] },
    fix: {
      event_id: "one",
      status: "valid",
      reason: "eligible",
      observed_at: "2026-09-25T00:00:00Z",
      received_at: "2026-09-25T00:00:00Z",
      historical: false,
      point: { latitude: 51, longitude: -114, accuracy_metres: null },
    },
    execution: {
      enabled: true,
      stopped_reason: null,
      consumer_healthy: true,
      state: {
        last_event_id: "one",
        condition: "inside",
        active: false,
        expires_at: "2026-09-25T00:01:00Z",
      },
    },
  },
};
it("expires location while refresh is paused and preserves unknown accuracy", () => {
  const now = Date.parse("2026-09-25T00:00:30Z");
  expect(locationPresentation(overview, now).point?.accuracy_metres).toBeNull();
  expect(locationPresentation(overview, now).condition).toBe("inside");
  expect(locationPresentation(overview, now + 60000).point).toBeNull();
  expect(locationPresentation(overview, now + 60000).condition).toBe("unknown");
  const incomplete = structuredClone(overview);
  incomplete.snapshot!.fix = {
    ...incomplete.snapshot!.fix!,
    status: "unknown",
    reason: "incomplete_fix",
    point: null,
  };
  expect(locationPresentation(incomplete, now).condition).toBe("unknown");
  const lagged = structuredClone(overview);
  lagged.snapshot!.execution.state.last_event_id = "earlier";
  expect(locationPresentation(lagged, now).condition).toBe("unknown");
  const historical = structuredClone(overview);
  historical.snapshot!.fix!.historical = true;
  expect(locationPresentation(historical, now + 60000).label).toBe(
    "Historical location",
  );
  expect(locationPresentation(historical, now).condition).toBe("unknown");
  const stopped = structuredClone(overview);
  stopped.snapshot!.execution.enabled = false;
  expect(locationPresentation(stopped, now).point).toBeNull();
});
it("requires GPS devices for maps and a workflow for alert panels", () => {
  const location = newWidget("location");
  expect(widgetError(location)).toBe("Choose at least one GPS device.");
  location.config.location_device_uuids = ["device"];
  expect(widgetError(location)).toBeNull();
  const alerts = newWidget("alerts");
  expect(widgetError(alerts)).toBe("Choose a workflow.");
  alerts.config.workflow_uuid = "workflow";
  expect(widgetError(alerts)).toBeNull();
});

describe("new panel types", () => {
  it("validates gauge scale, text and device health settings", () => {
    const gauge = newWidget("gauge");
    gauge.config.sources = [source];
    expect(widgetError(gauge)).toBeNull();
    gauge.config.max = 0;
    expect(widgetError(gauge)).toMatch(/maximum/);
    gauge.config.max = 100;
    gauge.config.sources = [1, 2, 3, 4, 5].map((n) => ({ ...source, parameter_uuid: String(n) }));
    expect(widgetError(gauge)).toMatch(/up to 4/);
    const text = newWidget("text");
    expect(widgetError(text)).toMatch(/text/);
    text.config.text = "<b>Call the site</b>";
    expect(widgetError(text)).toBeNull();
    const health = newWidget("device_health");
    expect(widgetError(health)).toMatch(/device/);
    health.config.devices = [{ device_uuid: "device" }];
    expect(widgetError(health)).toBeNull();
  });
  it("splits a gauge scale into band segments clipped to min and max", () => {
    const segments = gaugeSegments(
      { ...source, thresholds: [{ value: 225, label: "Normal", color: "#00ff00" }, { value: 300, label: "High", color: "#ff0000" }] },
      220,
      240,
    );
    expect(segments.map((s) => [s.label, s.from, s.to])).toEqual([
      ["Below range", 0, 25],
      ["Normal", 25, 100],
    ]);
  });
  it("uses the profile precision when the panel sets none", () => {
    const device = {
      applied_configuration_uuid: "c",
      configurations: [
        {
          uuid: "c",
          definition: {
            profile_canonical_json: JSON.stringify({
              parameters: [{ uuid: "parameter", display: { precision: 2 } }],
            }),
          },
        },
      ],
    } as unknown as DeviceDetail;
    expect(profilePrecision(device, "parameter")).toBe(2);
    expect(profilePrecision(device, "other")).toBeUndefined();
  });
});
describe("chart helpers", () => {
  it("maps default colours to skin variables and keeps custom ones", () => {
    expect(seriesColor("#3987E5")).toBe("var(--series-1)");
    expect(seriesColor("#16a34a")).toBe("var(--series-2)");
    expect(seriesColor("#123456")).toBe("#123456");
  });
  it("sizes axis ticks to the range", () => {
    const at = Date.parse("2026-09-09T12:30:00Z");
    expect(tickFormatter(3600000, "utc")(at)).toMatch(/12:30/);
    expect(tickFormatter(30 * 86400000, "utc")(at)).not.toMatch(/12:30/);
  });
  it("summarizes known values and escapes CSV cells", () => {
    expect(seriesStats([null, 2, 4, null])).toEqual({ min: 2, avg: 3, max: 4, last: 4 });
    expect(seriesStats([null])).toBeNull();
    expect(toCsv([["a", 'say "hi", ok'], [null, { v: 1 }]])).toBe(
      'a,"say ""hi"", ok"\r\n,"{""v"":1}"\r\n',
    );
    expect(toCsv([["=cmd()", -2.5]])).toBe("'=cmd(),-2.5\r\n");
  });
});
