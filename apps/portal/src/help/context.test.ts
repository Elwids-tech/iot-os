import { describe, expect, it } from "vitest";
import { helpContextForPath } from "./context";

describe("Help context", () => {
  it("resolves task context without including private resource identifiers", () => {
    expect(
      helpContextForPath(
        "/organizations/private-org/devices/private-device/commands",
      ),
    ).toBe("devices.commands");
    expect(
      helpContextForPath(
        "/organizations/private-org/devices/private-device/measurements",
      ),
    ).toBe("devices.measurements");
    expect(
      helpContextForPath(
        "/organizations/private-org/device-profiles/private-profile/review",
      ),
    ).toBe("device-profiles.review");
    expect(
      helpContextForPath(
        "/organizations/private-org/alerts/notifications/private-workflow",
      ),
    ).toBe("alerts.notifications.workflow");
    expect(helpContextForPath("/organizations/private-org/alerts")).toBe("alerts");
    expect(
      helpContextForPath("/organizations/private-org/alerts/private-alert"),
    ).toBe("alerts.detail");
    expect(helpContextForPath("/organizations/private-org/alerts/events")).toBe(
      "alerts.events",
    );
    expect(
      helpContextForPath("/organizations/private-org/alerts/preferences"),
    ).toBe("alerts.preferences");
    expect(helpContextForPath("/organizations/private-org/geofences/new")).toBe(
      "geofences.editor",
    );
    expect(helpContextForPath("/organizations/private-org/members")).toBe("members");
    expect(helpContextForPath("/organizations/private-org/roles")).toBe("roles");
    expect(helpContextForPath("/organizations/private-org/roles/42")).toBe("roles.editor");
    expect(helpContextForPath("/organizations/private-org/settings/members")).toBe("members");
    expect(helpContextForPath("/organizations/private-org/settings/roles")).toBe("roles");
    expect(helpContextForPath("/organizations/private-org/settings/roles/42")).toBe("roles.editor");
    expect(helpContextForPath("/organizations/private-org/settings/notifications")).toBe("alerts.notifications");
    expect(
      helpContextForPath("/organizations/private-org/settings/notifications/private-workflow"),
    ).toBe("alerts.notifications.workflow");
    expect(helpContextForPath("/organizations/private-org/settings/email")).toBe("alerts.preferences");
  });
  it("uses section overviews for unsupported tabs and getting started outside a workspace", () => {
    expect(
      helpContextForPath(
        "/organizations/private-org/devices/private-device/unknown",
      ),
    ).toBe("devices.overview");
    expect(
      helpContextForPath("/organizations/private-org/unknown/private-id"),
    ).toBe("getting-started");
    expect(helpContextForPath("/organizations")).toBe("getting-started");
  });
});
