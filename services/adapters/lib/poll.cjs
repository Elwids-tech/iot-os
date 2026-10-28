const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const zlib = require("node:zlib");
const { publicAddress, secureLookup } = require("./broker.cjs");

// HTTP polling source (spec 020, FR-030 to FR-040): the request is built from
// settings only, fetched through a client that connects only to checked public
// addresses, and split into records with JSON Pointers.
const PLACEHOLDERS = ["cursor", "window_start", "window_end", "now", "page_size"];
const LIMITS = {
  timeoutMs: 30000,
  maxBytes: 8 * 1024 * 1024,
  maxHeaderBytes: 16 * 1024,
  maxRedirects: 3,
  maxRecords: 5000,
  maxRecordBytes: 1024 * 1024,
};
const REFUSED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function formatTime(ms, format = "iso") {
  if (format === "epoch_s") return String(Math.floor(ms / 1000));
  if (format === "epoch_ms") return String(Math.floor(ms));
  return new Date(ms).toISOString();
}

function fill(template, values) {
  return String(template).replace(/\{([a-z_]+)\}/g, (match, name) =>
    PLACEHOLDERS.includes(name) ? String(values[name] ?? "") : match,
  );
}

// Only {name} with a lower-case name is a placeholder, so JSON body templates such
// as {"limit": 100} are not mistaken for one.
function usedPlaceholders(text) {
  return [...String(text).matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
}

function ensure(condition, message) {
  if (!condition) throw Error(message);
}

function parseUrl(value, allowPrivate) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("Use a valid HTTPS URL");
  }
  ensure(
    url.protocol === "https:" || (allowPrivate && url.protocol === "http:"),
    "Use an HTTPS URL",
  );
  ensure(!url.username && !url.password, "Remove credentials from the URL");
  ensure(!url.hash, "Remove the fragment from the URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  ensure(
    allowPrivate || !net.isIP(host) || publicAddress(host),
    "The vendor API must be publicly reachable",
  );
  return url;
}

// Settings are validated by Laravel at save; the runtime and the manager check them
// again because they act on them.
function validateSettings(source, { allowPrivate = false } = {}) {
  const request = source.request || {};
  ensure(["GET", "POST"].includes(request.method), "Use GET or POST");
  ensure(typeof request.url === "string" && request.url.length <= 2000, "A URL is required");
  ensure(!/[{}]/.test(request.url), "Use query parameters for placeholders");
  parseUrl(request.url, allowPrivate);
  for (const list of [request.query || [], request.headers || []]) {
    ensure(Array.isArray(list) && list.length <= 20, "Use at most 20 parameters");
    for (const item of list) {
      ensure(typeof item.name === "string" && item.name && item.name.length <= 128, "Name every parameter");
      ensure(typeof item.value === "string" && item.value.length <= 1000, "Parameter values are limited to 1,000 characters");
      ensure(usedPlaceholders(item.value).every((p) => PLACEHOLDERS.includes(p)), "Unknown placeholder");
    }
  }
  for (const header of request.headers || [])
    ensure(!REFUSED_HEADERS.has(header.name.toLowerCase()), `The ${header.name} header is set by the platform`);
  if (request.body !== undefined && request.body !== null && request.body !== "") {
    ensure(request.method === "POST", "Only POST requests have a body");
    ensure(String(request.body).length <= 16384, "The body template is limited to 16 KiB");
    ensure(usedPlaceholders(request.body).every((p) => PLACEHOLDERS.includes(p)), "Unknown placeholder");
  }
  const placement = source.credentials?.placement || "none";
  ensure(["none", "header", "query", "bearer", "basic"].includes(placement), "Unknown credential placement");
  ensure(!["header", "query"].includes(placement) || source.credentials?.name, "Name the credential parameter");
  const cursor = source.cursor || {};
  ensure(["timestamp", "token", "window"].includes(cursor.kind), "Choose a cursor kind");
  ensure(cursor.kind === "window" || typeof cursor.pointer === "string", "Choose where the cursor is");
  const more = source.page?.more || (source.page?.size ? "full_page" : "none");
  ensure(["full_page", "token", "none"].includes(more), "Unknown paging rule");
  ensure(cursor.kind !== "window" || more !== "full_page", "Window cursors page with a token or not at all");
  ensure(more !== "token" || cursor.kind === "token", "Token paging needs a token cursor");
  return source;
}

function credentialParts(source, secrets) {
  const placement = source.credentials?.placement || "none";
  const name = source.credentials?.name;
  if (placement === "header") return { headers: { [name.toLowerCase()]: secrets.api_key || "" } };
  if (placement === "query") return { query: { [name]: secrets.api_key || "" } };
  if (placement === "bearer") return { headers: { authorization: `Bearer ${secrets.token || ""}` } };
  if (placement === "basic")
    return {
      headers: {
        authorization:
          "Basic " +
          Buffer.from(`${secrets.username || ""}:${secrets.password || ""}`).toString("base64"),
      },
    };
  return {};
}

function buildRequest(source, secrets, values, { allowPrivate = false } = {}) {
  const url = parseUrl(source.request.url, allowPrivate);
  const pageSize = source.page?.size;
  const query = [...(source.request.query || [])];
  if (pageSize && source.page?.size_param)
    query.push({ name: source.page.size_param, value: "{page_size}" });
  for (const item of query) url.searchParams.append(item.name, fill(item.value, values));
  const credentials = credentialParts(source, secrets);
  for (const [name, value] of Object.entries(credentials.query || {}))
    url.searchParams.set(name, value);
  const headers = { accept: "application/json", "accept-encoding": "gzip, deflate, br" };
  for (const item of source.request.headers || [])
    headers[item.name.toLowerCase()] = fill(item.value, values);
  Object.assign(headers, credentials.headers || {});
  let body;
  if (source.request.method === "POST") {
    body = Buffer.from(fill(source.request.body || "{}", values));
    headers["content-type"] = "application/json";
  }
  return {
    method: source.request.method,
    url,
    headers,
    body,
    credentialHeaders: Object.keys(credentials.headers || {}),
    credentialParams: Object.keys(credentials.query || {}),
  };
}

// Every redirect target is checked like the configured URL.
function redirectUrl(location, base, allowPrivate) {
  return parseUrl(new URL(location, base).toString(), allowPrivate);
}

// Connects only to the address the checked lookup returned, so a DNS answer cannot
// change between the check and the connection. Redirects are followed by hand and
// re-checked; credentials are sent only to the original host.
function safeRequest(request, { allowPrivate = false, ca, limits = LIMITS, lookup } = {}) {
  const started = Date.now();
  const deadline = started + limits.timeoutMs;
  const originHost = request.url.host;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    const timer = setTimeout(
      () => fail(Object.assign(Error("The vendor API did not answer in time"), { retryable: true })),
      limits.timeoutMs,
    );
    function attempt(url, headers, body, method, redirects) {
      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        url,
        {
          method,
          headers,
          lookup: lookup || (allowPrivate ? undefined : secureLookup),
          servername: net.isIP(url.hostname) ? undefined : url.hostname,
          ca: ca || undefined,
          maxHeaderSize: limits.maxHeaderBytes,
          timeout: Math.max(1, deadline - Date.now()),
          agent: false,
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (redirects >= limits.maxRedirects)
              return fail(Error("The vendor API redirected too many times"));
            let next;
            try {
              next = redirectUrl(res.headers.location, url, allowPrivate);
            } catch (error) {
              return fail(error);
            }
            const nextHeaders = { ...headers };
            if (next.host !== originHost) {
              for (const name of request.credentialHeaders || []) delete nextHeaders[name];
              for (const name of request.credentialParams || []) next.searchParams.delete(name);
            }
            const keepBody = [307, 308].includes(res.statusCode);
            return attempt(next, nextHeaders, keepBody ? body : undefined, keepBody ? method : "GET", redirects + 1);
          }
          const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
          let stream = res;
          if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
          else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
          else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
          const chunks = [];
          let size = 0;
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > limits.maxBytes) {
              req.destroy();
              stream.destroy();
              fail(Object.assign(Error("Response too large"), { tooLarge: true }));
              return;
            }
            chunks.push(chunk);
          });
          stream.on("error", () => fail(Error("The vendor API sent an unreadable response")));
          stream.on("end", () => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
              durationMs: Date.now() - started,
            });
          });
        },
      );
      req.on("timeout", () => req.destroy(Object.assign(Error("The vendor API did not answer in time"), { retryable: true })));
      req.on("error", (error) =>
        fail(
          /publicly reachable/.test(error.message)
            ? Error("The vendor API must be publicly reachable")
            : error.retryable
              ? error
              : Object.assign(Error("Could not reach the vendor API"), { retryable: true }),
        ),
      );
      if (body) req.end(body);
      else req.end();
    }
    attempt(request.url, request.headers, request.body, request.method, 0);
  });
}

function pointer(document, path) {
  if (path === "" || path === undefined || path === null) return document;
  ensure(typeof path === "string" && path.startsWith("/"), "JSON Pointers start with /");
  let value = document;
  for (const raw of path.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !(key in value)) return undefined;
    value = value[key];
  }
  return value;
}

function redact(text, secrets = {}) {
  let result = String(text);
  for (const value of Object.values(secrets))
    if (typeof value === "string" && value.length >= 4) result = result.split(value).join("[redacted]");
  return result;
}

function retryAfterSeconds(headers) {
  const value = headers?.["retry-after"];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(3600, seconds));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(3600, (date - Date.now()) / 1000)) : undefined;
}

// What to do with an answer: keep going, retry with backoff, or stop until a person
// acts (FR-038).
function classify(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "stop";
}

const STOP_REASONS = {
  400: "Bad request",
  401: "Credentials rejected",
  403: "Credentials rejected",
  404: "Not found",
};

function cursorValues(source, cursor, now) {
  const format = source.time_format || "iso";
  const values = { cursor: cursor ?? "", now: formatTime(now, format), page_size: source.page?.size ?? "" };
  if (source.cursor.kind === "window") {
    values.window_start = cursor ?? "";
    values.window_end = formatTime(now - 1000 * (source.cursor.lag_seconds || 0), format);
  }
  return values;
}

// Fetches one page. Never throws for an HTTP answer: the result says whether to
// continue, retry or stop, and why.
async function fetchPage(source, secrets, cursor, { allowPrivate = false, now = Date.now() } = {}) {
  const values = cursorValues(source, cursor, now);
  const request = buildRequest(source, secrets, values, { allowPrivate });
  let response;
  try {
    response = await safeRequest(request, { allowPrivate, ca: secrets.ca_certificate });
  } catch (error) {
    return {
      outcome: error.tooLarge || !error.retryable ? "stop" : "retry",
      error: error.tooLarge ? "Response too large; use a smaller page size" : error.message,
      values,
    };
  }
  const base = {
    status: response.status,
    durationMs: response.durationMs,
    headers: response.headers,
    body: response.body,
    values,
  };
  const outcome = classify(response.status);
  if (outcome !== "ok")
    return {
      ...base,
      outcome,
      error: outcome === "stop" ? STOP_REASONS[response.status] || `HTTP ${response.status}` : `HTTP ${response.status}`,
      retryAfter: retryAfterSeconds(response.headers),
    };
  let json;
  try {
    json = JSON.parse(response.body.toString("utf8"));
  } catch {
    return { ...base, outcome: "stop", error: "The response is not JSON" };
  }
  const records = pointer(json, source.records || "");
  if (!Array.isArray(records))
    return { ...base, json, outcome: "stop", error: "No records at the configured location" };
  if (records.length > LIMITS.maxRecords)
    return { ...base, json, outcome: "stop", error: "More than 5,000 records in one page; use a smaller page size" };
  let nextCursor = cursor ?? null;
  if (source.cursor.kind === "window") nextCursor = values.window_end;
  else {
    const found = pointer(json, source.cursor.pointer);
    if (found !== undefined && found !== null && found !== "") nextCursor = String(found);
  }
  const more = source.page?.more || (source.page?.size ? "full_page" : "none");
  const hasMore =
    more === "full_page"
      ? records.length > 0 && records.length >= source.page.size
      : more === "token"
        ? nextCursor !== null && nextCursor !== (cursor ?? null)
        : false;
  return { ...base, json, outcome: "ok", records, nextCursor, more: hasMore };
}

// The Fetch now view: what the portal and the onboarding assistant may see.
function fetchResult(page, secrets, { excerptBytes = 256 * 1024, recordLimit = 20 } = {}) {
  const text = page.body ? redact(page.body.toString("utf8"), secrets) : "";
  const headers = {};
  for (const [name, value] of Object.entries(page.headers || {}))
    if (!["set-cookie", "authorization"].includes(name)) headers[name] = redact(Array.isArray(value) ? value.join(", ") : value, secrets);
  return {
    status: page.status ?? null,
    duration_ms: page.durationMs ?? null,
    headers,
    excerpt: text.slice(0, excerptBytes),
    truncated: text.length > excerptBytes,
    record_count: page.records?.length ?? 0,
    records: (page.records || []).slice(0, recordLimit).map((record) => JSON.parse(redact(JSON.stringify(record), secrets))),
    next_cursor: page.nextCursor ?? null,
    more: !!page.more,
    error: page.error ?? null,
  };
}

module.exports = {
  LIMITS,
  PLACEHOLDERS,
  buildRequest,
  classify,
  cursorValues,
  fetchPage,
  fetchResult,
  fill,
  formatTime,
  pointer,
  redact,
  redirectUrl,
  retryAfterSeconds,
  safeRequest,
  validateSettings,
};
