/**
 * The alert chime (spec 022): two short sine notes synthesized with Web Audio, so there
 * is no audio file. Browsers allow audio only after the person has clicked or typed in
 * the page, so the context is created on the first interaction; until then, or without
 * Web Audio, `play()` does nothing and says so. One tab of the browser plays each new
 * activation: tabs claim it through localStorage. Without storage every tab may chime.
 */

const SOUND_KEY = "iot-os.alert-bell.sound";
const chimedKey = (userId: number) => `iot-os.alert-bell.chimed.${userId}`;
/** Long enough for another tab's write to arrive before the claim is read back. */
const SETTLE_MS = 250;

type AudioContextConstructor = new () => AudioContext;
let context: AudioContext | null = null;
const tab = Math.random().toString(36).slice(2);

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Sound is on unless this browser turned it off. */
export function soundEnabled(): boolean {
  try {
    return storage()?.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    if (on) storage()?.removeItem(SOUND_KEY);
    else storage()?.setItem(SOUND_KEY, "off");
  } catch {
    // The switch still works for this page.
  }
}

/** Calls `change` when another tab turns the sound on or off. */
export function onSoundChange(change: (on: boolean) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === SOUND_KEY || event.key === null) change(soundEnabled());
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

function unlock() {
  const Constructor = (globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext) as AudioContextConstructor | undefined;
  if (!Constructor) return;
  try {
    context ??= new Constructor();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    context = null;
  }
}

/** Creates or resumes the audio context on the first click or key press. */
export function listenForUnlock(): () => void {
  const options = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", unlock, options);
  window.addEventListener("keydown", unlock, options);
  return () => {
    window.removeEventListener("pointerdown", unlock, options);
    window.removeEventListener("keydown", unlock, options);
  };
}

/** Whether this tab can play now; a tab that cannot must not claim a chime. */
export const audioReady = () => context?.state === "running";

/** Plays the chime; false when audio is locked, missing or failed. */
export function play(): boolean {
  if (!context || context.state !== "running") return false;
  try {
    const start = context.currentTime;
    for (const [offset, frequency] of [[0, 880], [0.14, 1175]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.26);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.27);
    }
    return true;
  } catch {
    return false;
  }
}

type Claim = { id: string; tab: string };
const read = (value: string | null): Claim | null => {
  try {
    const claim = value ? (JSON.parse(value) as Claim) : null;
    return claim && typeof claim.id === "string" ? claim : null;
  } catch {
    return null;
  }
};

/**
 * Claims activation `id` for this tab: false when a tab of this browser already chimed
 * for it or a newer one. Tabs that write at the same moment settle on the last writer.
 */
export async function claim(userId: number, id: string, wait = (ms: number) => new Promise((done) => setTimeout(done, ms))): Promise<boolean> {
  const store = storage();
  if (!store) return true;
  try {
    const key = chimedKey(userId);
    const last = read(store.getItem(key));
    if (last && last.id >= id) return false;
    store.setItem(key, JSON.stringify({ id, tab }));
    await wait(SETTLE_MS);
    const winner = read(store.getItem(key));
    return !winner || (winner.id === id && winner.tab === tab);
  } catch {
    return true;
  }
}
