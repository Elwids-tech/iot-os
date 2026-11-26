import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Spec 030 PR 030-1, spec 009 PR 8: the grant editor's Places mode, with mocked management APIs.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a";
const id = "08b842d4-dbe9-44b7-a82f-8409bf31402a";
const device = "08b842d4-dbe9-44b7-a82f-8409bf31403a";
const hall = "08b842d4-dbe9-44b7-a82f-8409bf31404a";
const yard = "08b842d4-dbe9-44b7-a82f-8409bf31405a";
const base = `/organizations/${org}/integrations`;
const type = (key: string, name: string) => ({ key, name });
const entityRows = [
  { uuid: hall, name: "Packaging hall", path_name: "PackagingHall", path: "Riverside/PackagingHall", depth: 1, type: type("area", "Area"), parent_uuid: null, children_count: 0, archived_at: null },
  { uuid: yard, name: "Yard", path_name: "Yard", path: "Yard", depth: 0, type: type("site", "Site"), parent_uuid: null, children_count: 0, archived_at: null },
];
const page1 = (data: unknown[]) => ({ data, meta: { current_page: 1, last_page: 1, per_page: 50, total: data.length } });
async function setup(page: Page) {
  const state: { app: any } = { app: null };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      body = req.postDataJSON();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    const context = {
      uuid: org,
      name: "Test workspace",
      slug: "test",
      capabilities: { devices: { view: true, manage: true, command: false } },
    };
    const entitiesOf = (uuids: string[]) =>
      entityRows.filter((entity) => uuids.includes(entity.uuid)).map((entity) => ({ uuid: entity.uuid, name: entity.name, path: entity.path, type_key: entity.type.key }));
    if (path === "/api/v1/me")
      return reply({
        data: {
          id: 1,
          name: "Manager",
          email: "manager@example.test",
          email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false },
          organizations: [context],
        },
      });
    if (path.endsWith("/context")) return reply({ data: context });
    if (path.endsWith("/entities/search")) {
      const q = (new URL(req.url()).searchParams.get("q") ?? "").toLowerCase();
      return reply(page1(entityRows.filter((entity) => entity.name.toLowerCase().includes(q))));
    }
    if (path.endsWith("/entities")) return reply(page1(entityRows.filter((entity) => entity.depth === 0)));
    if (path.endsWith("/devices"))
      return reply({
        data: [{ uuid: device, name: "Field tag", code: "tag-1" }],
        meta: { current_page: 1, last_page: 1, total: 1 },
      });
    if (path.endsWith("/applications")) {
      if (req.method() === "POST")
        state.app = {
          ...body,
          uuid: id,
          revision: 1,
          grant_revision: 1,
          revoked_at: null,
          credential: null,
          devices: [],
          entities: entitiesOf(body.entity_uuids ?? []),
        };
      return reply(
        { data: req.method() === "POST" ? state.app : state.app ? [state.app] : [] },
        req.method() === "POST" ? 201 : 200,
      );
    }
    if (path.endsWith("/webhook")) return reply({ data: null });
    if (path.endsWith("/" + id) && req.method() === "PUT") {
      state.app = {
        ...state.app,
        ...body,
        revision: state.app.revision + 1,
        grant_revision: state.app.grant_revision + 1,
        credential: null,
        devices: [],
        entities: entitiesOf(body.entity_uuids ?? []),
      };
      return reply({ data: state.app });
    }
    return reply({ data: [] });
  });
  return { state, errors };
}
async function confirm(page: Page, name: string) {
  await page.getByRole("alertdialog").getByRole("button", { name, exact: true }).click();
}
async function pickPlace(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Add a place", exact: true }).click();
  await page.getByRole("combobox", { name: "Search add a place" }).fill(name.slice(0, 4));
  await page.getByRole("option", { name: new RegExp("^" + name) }).click();
}

test("manager grants places, saves past the scope confirmation and sees an emptied scope", async ({ page }) => {
  const { state, errors } = await setup(page);
  await page.goto(base);
  await page.getByRole("button", { name: "New application", exact: true }).click();
  await page.getByLabel("Application name").fill("Twin");
  for (const name of ["Device details", "Hierarchy"])
    await page.getByRole("checkbox", { name, exact: true }).check();
  // Both modes are offered; Places replaces the device list with a scope of any entities.
  await expect(page.getByRole("tab", { name: "Devices" })).toBeVisible();
  await page.getByRole("tab", { name: "Places" }).click();
  await pickPlace(page, "Packaging hall");
  await pickPlace(page, "Yard");
  const granted = page.getByRole("list", { name: "Granted places" });
  await expect(granted.getByRole("listitem")).toHaveCount(2);
  await expect(granted.getByRole("listitem").first()).toContainText("Riverside/PackagingHall");
  await expect(page.getByText("2 of 50 places", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save application", exact: true }).click();
  expect(state.app.entity_uuids).toEqual([hall, yard]);
  expect(state.app.site_uuids).toBeUndefined();
  expect(state.app.device_uuids).toEqual([]);
  expect(state.app.abilities).toEqual(["devices:read", "entities:read"]);
  await expect(page.getByRole("cell", { name: "2 places" })).toBeVisible();
  await page.getByRole("link", { name: "Twin", exact: true }).click();
  await expect(page.getByText("2 places: Packaging hall, Yard")).toBeVisible();
  await expect(page.getByText("2 of 10", { exact: true })).toBeVisible();
  // Removing a place is a scope change: the confirmation names the consequences and the revision moves.
  await page.getByRole("button", { name: "Remove Yard" }).click();
  await page.getByRole("button", { name: "Save grants", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("including devices added or moved there later");
  await confirm(page, "Save grants");
  await expect(page.getByText("Grants saved.", { exact: false })).toBeVisible();
  expect(state.app.grant_revision).toBe(2);
  expect(state.app.entity_uuids).toEqual([hall]);
  await expect(page.getByText("1 place: Packaging hall")).toBeVisible();
  // The last place is archived elsewhere: the reloaded application shows the emptied scope.
  state.app = { ...state.app, entity_uuids: [], entities: [], revision: 3, grant_revision: 3 };
  await page.getByRole("button", { name: "Reload latest state" }).click();
  await confirm(page, "Reload");
  await expect(page.getByRole("alert").filter({ hasText: "No places" })).toContainText(
    "This application reads nothing until a place is granted",
  );
  await expect(page.getByRole("button", { name: "Save grants", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a scope and a device list cannot both be set", async ({ page }) => {
  await setup(page);
  await page.goto(base);
  await page.getByRole("button", { name: "New application", exact: true }).click();
  await page.getByLabel("Application name").fill("Twin");
  await page.getByRole("checkbox", { name: "Device details", exact: true }).check();
  await page.getByRole("combobox", { name: "Add a device" }).click();
  await page.getByRole("combobox", { name: "Search add a device" }).fill("Field");
  await page.getByRole("option", { name: "Field tag · tag-1" }).click();
  await expect(page.getByRole("button", { name: "Save application", exact: true })).toBeEnabled();
  // Switching to Places clears the device list, so the form is incomplete until a place is picked.
  await page.getByRole("tab", { name: "Places" }).click();
  await expect(page.getByRole("button", { name: "Save application", exact: true })).toBeDisabled();
  await expect(page.getByText("Add a name, a permission and a device or place")).toBeVisible();
  await pickPlace(page, "Yard");
  await expect(page.getByRole("button", { name: "Save application", exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: "Devices" }).click();
  await expect(page.getByRole("list", { name: "Granted devices" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save application", exact: true })).toBeDisabled();
});
