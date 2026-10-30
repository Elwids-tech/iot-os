const fs = require("node:fs");
const crypto = require("node:crypto");

// Runtime state lives in the tenant runtime's /data volume, which survives
// restarts, redeployments and re-creation of the container.
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value, mode = 0o600) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode });
  fs.renameSync(temporary, file);
}

const DAY = 24 * 60 * 60 * 1000;

// Message identifiers already published, per adapter: an append-only log of
// "<epoch ms> <key>" lines, bounded to 7 days and 100,000 keys, compacted when it
// holds twice what it keeps. A key is added only after the platform broker
// acknowledged the publish, so a crash can repeat a message but never lose one.
class DedupLog {
  constructor(file, { maxAgeMs = 7 * DAY, maxKeys = 100000, now = Date.now } = {}) {
    this.file = file;
    this.maxAgeMs = maxAgeMs;
    this.maxKeys = maxKeys;
    this.now = now;
    this.keys = new Map();
    this.lines = 0;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {}
    const oldest = this.now() - maxAgeMs;
    for (const line of text.split("\n")) {
      const [at, key] = line.split(" ");
      const time = Number(at);
      if (!key || !Number.isFinite(time)) continue;
      this.lines++;
      if (time < oldest) continue;
      this.keys.delete(key);
      this.keys.set(key, time);
    }
    this.trim();
    if (this.lines > this.keys.size) this.compact();
  }
  static key(sourceDeviceId, messageId) {
    return crypto
      .createHash("sha256")
      .update(sourceDeviceId + "\0" + messageId)
      .digest("hex")
      .slice(0, 32);
  }
  has(key) {
    const time = this.keys.get(key);
    return time !== undefined && time >= this.now() - this.maxAgeMs;
  }
  add(key) {
    const time = this.now();
    this.keys.delete(key);
    this.keys.set(key, time);
    fs.appendFileSync(this.file, `${time} ${key}\n`, { mode: 0o600 });
    this.lines++;
    this.trim();
    if (this.lines >= 2 * Math.max(this.keys.size, 1000)) this.compact();
  }
  trim() {
    const oldest = this.now() - this.maxAgeMs;
    for (const [key, time] of this.keys) {
      if (this.keys.size <= this.maxKeys && time >= oldest) break;
      this.keys.delete(key);
    }
  }
  compact() {
    const text = [...this.keys].map(([key, time]) => `${time} ${key}\n`).join("");
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text, { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.lines = this.keys.size;
  }
}

// The last birth certificate of each source an adapter published, so a redeployed
// publisher announces every known source right after its NBIRTH. Without it a
// redeploy (each device activation is one) leaves every source offline until it
// reports again, and activating the next device fails. Written at most every
// `intervalMs` while running, on close, and by the publisher before it announces a
// changed metric set, so a restart never announces fewer metrics than were known.
class BirthStore {
  constructor(file, { intervalMs = 30000, now = Date.now } = {}) {
    this.file = file;
    this.intervalMs = intervalMs;
    this.now = now;
    this.sources = new Map();
    this.dirty = false;
    this.savedAt = -Infinity;
    for (const [id, entry] of Object.entries(readJson(file, {}) || {}))
      if (Array.isArray(entry?.metrics) && typeof entry.names === "string") this.sources.set(id, entry);
  }
  set(id, entry) {
    this.sources.set(id, entry);
    this.dirty = true;
  }
  flush(force = false) {
    if (!this.dirty || (!force && this.now() - this.savedAt < this.intervalMs)) return;
    writeJson(this.file, Object.fromEntries(this.sources));
    this.dirty = false;
    this.savedAt = this.now();
  }
}

module.exports = { readJson, writeJson, DedupLog, BirthStore };
