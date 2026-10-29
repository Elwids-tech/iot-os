import { afterEach, describe, expect, it } from "vitest";
import { audioReady, claim, play, setSoundEnabled, soundEnabled } from "./chime";

const now = () => Promise.resolve();
const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as unknown as Storage;
};
const use = (storage: Storage | undefined) =>
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

afterEach(() => use(undefined));

describe("the chime's settings and claims", () => {
  it("defaults the sound to on and remembers turning it off per browser", () => {
    use(memory());
    expect(soundEnabled()).toBe(true);
    setSoundEnabled(false);
    expect(soundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);
  });

  it("lets one tab claim each activation, and never an older one", async () => {
    use(memory());
    expect(await claim(1, "01a189aa-f979-70d9-aafd-8949bc3c3e8e", now)).toBe(true);
    expect(await claim(1, "01a189aa-f979-70d9-aafd-8949bc3c3e8e", now)).toBe(false);
    expect(await claim(1, "01a189aa-ed94-7397-87c2-9bfd735e55e4", now)).toBe(false);
    expect(await claim(1, "01a189ab-0941-73b9-9bc4-c6e8ad890a47", now)).toBe(true);
    // Each person keeps their own claims.
    expect(await claim(2, "01a189aa-ed94-7397-87c2-9bfd735e55e4", now)).toBe(true);
  });

  it("yields to another tab that wrote while this one settled", async () => {
    const storage = memory();
    use(storage);
    const id = "01a189aa-f979-70d9-aafd-8949bc3c3e8e";
    const other = async () => storage.setItem("iot-os.alert-bell.chimed.1", JSON.stringify({ id, tab: "other" }));
    expect(await claim(1, id, other)).toBe(false);
  });

  it("works without storage, or when it throws", async () => {
    expect(soundEnabled()).toBe(true);
    expect(await claim(1, "01a189aa-f979-70d9-aafd-8949bc3c3e8e", now)).toBe(true);
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } } as unknown as Storage;
    use(broken);
    expect(soundEnabled()).toBe(true);
    expect(() => setSoundEnabled(false)).not.toThrow();
    expect(await claim(1, "01a189aa-f979-70d9-aafd-8949bc3c3e8e", now)).toBe(true);
    Object.defineProperty(globalThis, "localStorage", { get: () => { throw new Error("blocked"); }, configurable: true });
    expect(soundEnabled()).toBe(true);
  });

  it("plays nothing before audio is unlocked or without Web Audio", () => {
    expect(audioReady()).toBe(false);
    expect(play()).toBe(false);
  });
});
