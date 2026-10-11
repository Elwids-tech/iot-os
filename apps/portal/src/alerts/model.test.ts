import { describe, expect, it } from "vitest";
import {
  alertDuration,
  alertQuery,
  alertTitle,
  conditionOf,
  eventState,
  legacyNotificationPath,
} from "./model";

describe("Alert presentation", () => {
  it("names the source once, without repeating a device the workflow name already carries", () => {
    expect(
      alertTitle({
        workflow_name: "GPS Demo Boundary — GPS Demo Tracker 3",
        device_name: "GPS Demo Tracker 3",
      }),
    ).toBe("GPS Demo Boundary — GPS Demo Tracker 3");
    expect(
      alertTitle({ workflow_name: "Phase voltage band", device_name: "Energy meter" }),
    ).toBe("Phase voltage band — Energy meter");
    expect(alertTitle({ workflow_name: "Phase voltage band", device_name: null })).toBe(
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
  it("sends the signed-in user's id for assigned to me, never the word me", () => {
    expect(alertQuery(new URLSearchParams("assignee=me"), 7).get("assignee")).toBe("7");
    expect(alertQuery(new URLSearchParams("assignee=me")).has("assignee")).toBe(false);
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
