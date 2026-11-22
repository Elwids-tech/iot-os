import type { PushDeviceRegistered, PushDeviceRegistration, PushTestResult } from "@iot-os/api-client"
import { api } from "../lib/api"
import { decodeKey, deviceLabel } from "./push-support"

/**
 * Push on this browser (spec 033, US2, research R7 to R9).
 *
 * The browser holds the subscription; the API holds the device. This module keeps the
 * two in step: turning push on subscribes and registers, every signed-in start syncs,
 * and signing out unsubscribes before the API forgets the device. The device this
 * browser registered is remembered under a personal key, so the next person on a
 * shared browser never inherits it.
 */
const sameKey = (subscription: PushSubscription, key: string) => {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const a = new Uint8Array(current)
  const b = decodeKey(key)
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

// This browser's registered device: personal (pwa/personal-state.ts), and tied to the
// person who registered it, so it means nothing to anyone else signing in here.
export const DEVICE_KEY = "iot-os.push-device"
type Stored = { user: number; uuid: string; endpoint: string }
const listeners = new Set<() => void>()

function read(): Stored | null {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null") as Stored | null
    return value && typeof value.uuid === "string" && typeof value.endpoint === "string" ? value : null
  } catch {
    return null
  }
}

function save(value: Stored | null) {
  try {
    if (value) localStorage.setItem(DEVICE_KEY, JSON.stringify(value))
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Blocked storage: the next start syncs again.
  }
  listeners.forEach((listener) => listener())
}

/** The device uuid this browser registered for `user`, or null. */
export function thisDevice(user: number): string | null {
  const value = read()
  return value && value.user === user ? value.uuid : null
}

export function subscribeDevice(listener: () => void): () => void {
  listeners.add(listener)
  const storage = (event: StorageEvent) => event.key === DEVICE_KEY && listener()
  window.addEventListener("storage", storage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", storage)
  }
}

export class PushUnavailable extends Error {}

/**
 * The browser's push calls can wait forever: a phone whose push service is down never
 * settles `subscribe()` or even `getSubscription()`. Nothing here waits longer than `ms`.
 */
export function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PushUnavailable(message)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** How long turning on waits for this device's push service before saying so. */
export const SUBSCRIBE_TIMEOUT = 20_000
/** Signing out never waits longer than this on push. */
export const SIGN_OUT_TIMEOUT = 3_000
const NO_ANSWER = "This device's push service didn't answer. Check the connection and try again."

/** The registered worker. The portal registers it at start; it is missing in `vite dev`. */
async function worker(timeout = 10_000): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new PushUnavailable("This browser has no service worker.")
  return within(navigator.serviceWorker.ready, timeout, "The app's background worker did not start. Reload and try again.")
}

/** The worker if it is registered already, without waiting for one that never starts. */
async function existingWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null
  return (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null
}

function registration(subscription: PushSubscription): PushDeviceRegistration {
  const keys = subscription.toJSON().keys ?? {}
  const encodings = (globalThis.PushManager as unknown as { supportedContentEncodings?: string[] } | undefined)?.supportedContentEncodings
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" },
    content_encoding: encodings && !encodings.includes("aes128gcm") ? "aesgcm" : "aes128gcm",
    label: deviceLabel(),
  }
}

async function register(subscription: PushSubscription, user: number): Promise<PushDeviceRegistered> {
  const device = await api.registerPushDevice(registration(subscription))
  save({ user, uuid: device.uuid, endpoint: subscription.endpoint })
  return device
}

export type TurnOnResult =
  | { status: "on"; device: PushDeviceRegistered; test: PushTestResult["status"] }
  | { status: "blocked" }
  | { status: "dismissed" }

/**
 * Turns push on here: asks for permission (call it straight from the click: Safari asks
 * only during one), subscribes, registers and sends a test push.
 */
export async function turnOn(publicKey: string, user: number): Promise<TurnOnResult> {
  const permission = await Notification.requestPermission()
  if (permission === "denied") return { status: "blocked" }
  if (permission !== "granted") return { status: "dismissed" }
  const { pushManager } = await worker()
  const subscription = await within(
    (async () => {
      const current = await pushManager.getSubscription()
      if (current && sameKey(current, publicKey)) return current
      await current?.unsubscribe().catch(() => false)
      return pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) })
    })(),
    SUBSCRIBE_TIMEOUT,
    NO_ANSWER,
  )
  const device = await register(subscription, user)
  const test = await api
    .testPushDevice(device.uuid)
    .then((result) => result.status)
    .catch((): PushTestResult["status"] => "failed")
  return { status: "on", device, test }
}

/**
 * - `none`: no subscription here, nothing to do.
 * - `mine`: the device is this person's.
 * - `registered`: a rotated subscription or a new key was registered again.
 * - `released`: it was someone else's; both sides forgot it.
 * - `unknown`: the API had no device for a subscription nobody here registered.
 * - `stopped`: this person had push on here and the API no longer has the device.
 * - `off`: this browser has no push subscription at this address.
 */
export type SyncOutcome = "none" | "off" | "mine" | "registered" | "released" | "unknown" | "stopped"

/** Who this page load already synced for; signing out starts over. */
let syncedFor: number | null = null

/**
 * Once per signed-in start: keeps this browser's subscription and the API's device in
 * step. `publicKey` is asked for only when there is a subscription, so most starts make
 * no request; it gives null when the deployment has no push.
 */
export async function sync(user: number, publicKey: () => Promise<string | null>): Promise<SyncOutcome> {
  if (syncedFor === user) return "none"
  syncedFor = user
  const ready = await existingWorker()
  const subscription = ready ? await within(ready.pushManager.getSubscription(), SUBSCRIBE_TIMEOUT, NO_ANSWER).catch(() => null) : null
  const stored = read()
  const mine = stored?.user === user ? stored : null
  if (!ready || !subscription) {
    // Permission was taken back, or the browser dropped it: the API forgets the device at
    // its next push.
    if (stored) save(null)
    return "off"
  }
  const key = await publicKey()
  if (!key) return "none"
  if (!sameKey(subscription, key)) {
    // The deployment's key changed: this subscription can never be reached again.
    await subscription.unsubscribe().catch(() => false)
    if (!mine) {
      save(null)
      return "none"
    }
    try {
      const fresh = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(key) })
      await register(fresh, user)
      return "registered"
    } catch {
      save(null)
      return "stopped"
    }
  }
  if (mine && mine.endpoint !== subscription.endpoint) {
    // The push service rotated it and the worker subscribed again (src/sw.ts).
    await register(subscription, user)
    return "registered"
  }
  const result = await api.syncPushDevice(subscription.endpoint)
  if (result.status === "mine" && result.uuid) {
    save({ user, uuid: result.uuid, endpoint: subscription.endpoint })
    return "mine"
  }
  await subscription.unsubscribe().catch(() => false)
  save(null)
  return result.status === "unknown" && mine ? "stopped" : result.status
}

/**
 * Stops push in this browser, closes this app's notifications still on screen (the next
 * person on a shared phone sees none of them) and forgets the device here. Signing out
 * calls it; the API removes the device with the session. It never holds sign-out up for
 * longer than SIGN_OUT_TIMEOUT, even where the push service never answers.
 */
export async function unsubscribeHere(): Promise<void> {
  syncedFor = null
  if (read()) save(null)
  const ready = await existingWorker()
  if (!ready) return
  await within(
    Promise.all([
      (async () => (await ready.getNotifications()).forEach((notification) => notification.close()))().catch(() => undefined),
      (async () => void (await (await ready.pushManager.getSubscription())?.unsubscribe()))(),
    ]),
    SIGN_OUT_TIMEOUT,
    "Push did not stop in time.",
  ).catch(() => undefined)
}

/** Dispatched on `window` once this browser's own device was removed: App.tsx signs out here. */
export const SIGNED_OUT_HERE = "iot-signed-out-here"

/** Removes a device. Removing this browser's own device also ends its sign-in (FR-028). */
export async function removeDevice(uuid: string, user: number): Promise<{ signedOut: boolean }> {
  const here = thisDevice(user) === uuid
  if (here) await unsubscribeHere()
  await api.removePushDevice(uuid)
  return { signedOut: here }
}
