import { describe, expect, it } from "vitest";
import type { Alert, ConnectivityAlert } from "@iot-os/api-client";
import {
  alertCause,
  alertCondition,
  alertDuration,
  alertQuery,
  alertTitle,
  conditionOf,
  eventState,
  isAlertId,
  kindsOf,
  legacyNotificationPath,
  sameSubject,
  sourceKey,
  subjectQuery,
  thresholdSource,
  thresholdText,
} from "./model";

describe("Alert presentation", () => {
  it("names the source once, without repeating a device the workflow name already carries", () => {
    expect(
      alertTitle({
        kind: "workflow",
        workflow_name: "GPS Demo Boundary — GPS Demo Tracker 3",
        device_name: "GPS Demo Tracker 3",
      }),
    ).toBe("GPS Demo Boundary — GPS Demo Tracker 3");
    expect(
      alertTitle({ kind: "workflow", workflow_name: "Phase voltage band", device_name: "Energy meter" }),
    ).toBe("Phase voltage band — Energy meter");
    expect(alertTitle({ kind: "workflow", workflow_name: "Phase voltage band", device_name: null })).toBe(
      "Phase voltage band",
    );
  });
  it("reads how long an alert has been active or took to clear", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(
      alertDuration({ activated_at: "2026-10-04T12:00:00Z", cleared_at: null }, now),
    ).toBe("Active for 5 d");
    expect(
      alertDuration(
        { activated_at: "2026-10-09T10:00:00Z", cleared_at: "2026-10-09T10:04:30Z" },
        now,
      ),
    ).toBe("Cleared after 4 min");
    expect(alertDuration({ activated_at: null, cleared_at: "2026-10-09T10:00:00Z" })).toBe(
      "Cleared",
    );
  });
});

describe("Alert list filters", () => {
  it("defaults to active alerts and keeps all explicit in the URL only", () => {
    expect(conditionOf(new URLSearchParams())).toBe("active");
    expect(conditionOf(new URLSearchParams("condition=cleared"))).toBe("cleared");
    expect(alertQuery(new URLSearchParams("view=individual&device=d1")).toString()).toBe(
      "device=d1&condition=active",
    );
    expect(alertQuery(new URLSearchParams("condition=all&page=2")).toString()).toBe("page=2");
  });
  it("treats only a UUID path segment as an alert id", () => {
    expect(isAlertId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(isAlertId("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(true);
    expect(isAlertId("settings")).toBe(false);
    expect(isAlertId("0f8fad5b-d9cb-469f-a165-70867728950e-x")).toBe(false);
  });
  it("sends the signed-in user's id for assigned to me, never the word me", () => {
    expect(alertQuery(new URLSearchParams("assignee=me"), 7).get("assignee")).toBe("7");
    expect(alertQuery(new URLSearchParams("assignee=me")).has("assignee")).toBe(false);
  });
});

const offline = (changes: Partial<ConnectivityAlert> = {}) =>
  ({
    uuid: "c1",
    kind: "device_offline",
    workflow_uuid: null,
    workflow_name: null,
    device_uuid: "d1",
    device_name: "Hot work box 2",
    subject: { type: "device", uuid: "d1", name: "Hot work box 2" },
    devices: [{ uuid: "d1", name: "Hot work box 2" }],
    condition: "active",
    cause: "missed_check_in",
    stopped_reason: null,
    threshold_seconds: 1020,
    threshold_automatic: true,
    reporting_interval_seconds: 240,
    poll_interval_seconds: 300,
    ...changes,
  }) as ConnectivityAlert;

describe("Device offline alerts (spec 018)", () => {
  it("names a connectivity alert by its kind and subject", () => {
    expect(alertTitle(offline())).toBe("Device offline — Hot work box 2");
    expect(
      alertTitle(offline({ kind: "gateway_offline", subject: { type: "gateway", uuid: "g1", name: "Yard gateway" } })),
    ).toBe("Gateway offline — Yard gateway");
  });
  it("reads the cause, and a stopped alert as stopped rather than cleared", () => {
    expect(alertCause(offline())).toBe("Missed check-in");
    expect(alertCondition(offline())).toBe("active");
    const stopped = offline({ condition: "cleared", stopped_reason: "device_deactivated", cause: "death_certificate" });
    expect(alertCondition(stopped)).toBe("stopped");
    expect(alertCause(stopped)).toBe("Death certificate · stopped: device deactivated");
    expect(alertCondition(offline({ condition: "cleared" }))).toBe("cleared");
  });
  it("explains an automatic threshold from the reporting and poll intervals", () => {
    expect(thresholdText(offline())).toBe("17 min, automatic");
    expect(thresholdSource(offline())).toBe("Automatic: 3 × 4 min reporting interval + 5 min poll, at least 15 min");
    expect(thresholdText(offline({ threshold_seconds: null }))).toBeNull();
    expect(thresholdText(offline({ threshold_seconds: 3600, threshold_automatic: false }))).toBe("1 h, set");
  });
  it("groups connectivity sources by kind and subject, workflows by workflow and device", () => {
    expect(sourceKey(offline())).toBe("device_offline|device:d1");
    const workflow = { kind: "workflow", workflow_uuid: "w1", device_uuid: "d1" } as Alert;
    expect(sourceKey(workflow)).toBe("w1|d1");
    expect(sourceKey({ latest: offline() } as never)).toBe("device_offline|device:d1");
  });
  it("finds a gateway alert's occurrences through a device it lists, matched by subject", () => {
    const gateway = offline({
      kind: "gateway_offline",
      device_uuid: null,
      subject: { type: "gateway", uuid: "g1", name: "Yard gateway" },
      devices: [{ uuid: "d7", name: "Meter" }],
    });
    expect(subjectQuery(gateway).toString()).toBe("kind%5B%5D=gateway_offline&device=d7");
    expect(sameSubject(gateway, { ...gateway, uuid: "c2" })).toBe(true);
    expect(sameSubject(gateway, { ...gateway, subject: { type: "gateway", uuid: "g2", name: "Other" } })).toBe(false);
    expect(sameSubject(gateway, offline())).toBe(false);
  });
  it("sends the kind filter as a repeated kind[] and ignores unknown kinds", () => {
    const page = new URLSearchParams("kind=device_offline&kind=gateway_offline&kind=nonsense");
    expect(kindsOf(page)).toEqual(["device_offline", "gateway_offline"]);
    expect(alertQuery(page).getAll("kind[]")).toEqual(["device_offline", "gateway_offline"]);
    expect(alertQuery(page).has("kind")).toBe(false);
  });
});

describe("Event log vocabulary", () => {
  it("uses Active and Cleared for firing, recovered and clear events", () => {
    expect(eventState({ status: "firing", active: true })).toBe("Active");
    expect(eventState({ status: "firing", active: false })).toBe("Cleared");
    expect(eventState({ status: "resolved", active: false })).toBe("Cleared");
  });
  it("redirects notification center links into the event log and Settings", () => {
    expect(
      legacyNotificationPath("org-1", new URLSearchParams("status=resolved&source=service")),
    ).toBe("/organizations/org-1/alerts/events?status=cleared&source=service");
    expect(legacyNotificationPath("org-1", new URLSearchParams("tab=preferences&page=3"))).toBe(
      "/organizations/org-1/settings/email",
    );
  });
});
