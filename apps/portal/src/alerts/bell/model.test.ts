import { describe, expect, it } from "vitest";
import { initialChime, nextChime, pollInterval } from "./model";

// UUIDv7 ids in time order.
const [first, second, third] = [
  "01a189aa-ed94-7397-87c2-9bfd735e55e4",
  "01a189aa-f979-70d9-aafd-8949bc3c3e8e",
  "01a189ab-0941-73b9-9bc4-c6e8ad890a47",
];

describe("the alert chime", () => {
  it("never chimes for the backlog on the first summary", () => {
    expect(nextChime(initialChime, { newest_unread_activation_id: second })).toEqual({
      state: { started: true, baseline: second },
      chime: null,
    });
    expect(nextChime(initialChime, { newest_unread_activation_id: null }).chime).toBeNull();
  });

  it("chimes once for a newer activation and moves the baseline forward", () => {
    const loaded = nextChime(initialChime, { newest_unread_activation_id: first }).state;
    const arrived = nextChime(loaded, { newest_unread_activation_id: third });
    expect(arrived).toEqual({ state: { started: true, baseline: third }, chime: third });
    expect(nextChime(arrived.state, { newest_unread_activation_id: third }).chime).toBeNull();
  });

  it("chimes when the first activation arrives on an empty bell", () => {
    const empty = nextChime(initialChime, { newest_unread_activation_id: null }).state;
    expect(nextChime(empty, { newest_unread_activation_id: first }).chime).toBe(first);
  });

  it("stays quiet when the newest unread activation is older, equal or gone", () => {
    const seen = nextChime(initialChime, { newest_unread_activation_id: second }).state;
    expect(nextChime(seen, { newest_unread_activation_id: first })).toEqual({ state: seen, chime: null });
    expect(nextChime(seen, { newest_unread_activation_id: second }).chime).toBeNull();
    expect(nextChime(seen, { newest_unread_activation_id: null })).toEqual({ state: seen, chime: null });
  });

  it("polls every 15 s while visible and every 60 s while hidden", () => {
    expect(pollInterval("visible")).toBe(15_000);
    expect(pollInterval("hidden")).toBe(60_000);
  });
});
